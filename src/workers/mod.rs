//! Background worker: delivers due scheduled messages and purges expired
//! (ephemeral) ones. Runs every 15s.

use std::sync::Arc;
use std::time::Duration;

use serde_json::json;
use uuid::Uuid;

use crate::models::message::Message;
use crate::services::message_service;
use crate::services::websocket_hub::{WsEnvelope, WsEvent};
use crate::state::AppState;

pub async fn run(state: Arc<AppState>) {
    loop {
        tokio::time::sleep(Duration::from_secs(15)).await;
        if let Err(e) = deliver_scheduled(&state).await {
            tracing::warn!(error = %e, "Livraison des messages programmés échouée");
        }
        if let Err(e) = purge_expired(&state).await {
            tracing::warn!(error = %e, "Purge des messages éphémères échouée");
        }
    }
}

/// Deliver scheduled messages whose time has come (clear scheduled_at, bump the
/// conversation, broadcast them like a fresh message).
async fn deliver_scheduled(st: &AppState) -> anyhow::Result<()> {
    let due: Vec<Message> = sqlx::query_as(
        "UPDATE chat.messages SET scheduled_at = NULL
         WHERE scheduled_at IS NOT NULL AND scheduled_at <= NOW() AND deleted_at IS NULL
         RETURNING *",
    )
    .fetch_all(&st.db)
    .await?;

    for msg in due {
        sqlx::query("UPDATE chat.conversations SET updated_at = NOW() WHERE id = $1")
            .bind(msg.conversation_id)
            .execute(&st.db)
            .await
            .ok();
        let members = message_service::get_member_ids(&st.db, msg.conversation_id)
            .await
            .unwrap_or_default();
        st.ws_hub
            .send_to_many(
                &members,
                WsEnvelope { event: WsEvent::NewMessage, payload: json!({ "message": msg }) },
                None,
            )
            .await;
    }
    Ok(())
}

/// Tombstone ephemeral messages past their TTL and notify members.
async fn purge_expired(st: &AppState) -> anyhow::Result<()> {
    let expired: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "UPDATE chat.messages
         SET message_type = 'deleted', encrypted_data = '', deleted_at = NOW()
         WHERE expires_at IS NOT NULL AND expires_at <= NOW() AND deleted_at IS NULL
         RETURNING id, conversation_id",
    )
    .fetch_all(&st.db)
    .await?;

    for (id, conv_id) in expired {
        let members = message_service::get_member_ids(&st.db, conv_id).await.unwrap_or_default();
        st.ws_hub
            .send_to_many(
                &members,
                WsEnvelope { event: WsEvent::MessageUpdated, payload: json!({ "message_id": id, "deleted": true }) },
                None,
            )
            .await;
    }
    Ok(())
}
