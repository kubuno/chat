use crate::state::AppState;
use serde_json::{json, Value};
use uuid::Uuid;

/// Publier un event vers le core via NOTIFY PostgreSQL
pub async fn publish_to_core(st: &AppState, event_type: &str, payload: Value) {
    let event = json!({
        "type":    event_type,
        "payload": payload,
        "module":  "chat",
    });
    let payload_str = event.to_string();
    sqlx::query("SELECT pg_notify('kubuno_events', $1)")
        .bind(&payload_str)
        .execute(&st.db)
        .await
        .map_err(|e| tracing::warn!(error = %e, event_type, "pg_notify échoué"))
        .ok();
}

pub async fn emit_message_sent(st: &AppState, chat_id: Uuid, from_user_id: Uuid) {
    publish_to_core(
        st,
        "MessageSent",
        json!({ "chat_id": chat_id, "from_user_id": from_user_id, "module_id": "chat" }),
    )
    .await;
}
