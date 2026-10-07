//! Background worker: delivers due scheduled messages and purges expired
//! (ephemeral) ones. Runs every 15s.

use std::sync::Arc;
use std::time::Duration;

use kubuno_db::{params, DbQueryBuilder};
use serde_json::json;
use uuid::Uuid;

use crate::models::message::Message;
use crate::services::message_service;
use crate::services::websocket_hub::{WsEnvelope, WsEvent};
use crate::state::AppState;

pub async fn run(state: Arc<AppState>) {
    let mut ticks: u64 = 0;
    loop {
        tokio::time::sleep(Duration::from_secs(15)).await;
        if let Err(e) = deliver_scheduled(&state).await {
            tracing::warn!(error = %e, "Livraison des messages programmés échouée");
        }
        if let Err(e) = purge_expired(&state).await {
            tracing::warn!(error = %e, "Purge des messages éphémères échouée");
        }
        // Draft rooms whose form never came back. Nothing is waiting on this,
        // so once every five minutes (20 × 15s) is soon enough.
        ticks = ticks.wrapping_add(1);
        if ticks.is_multiple_of(20) {
            if let Err(e) = purge_provisional(&state).await {
                tracing::warn!(error = %e, "Purge des salles de réunion provisoires échouée");
            }
        }
        // The retention purge scans by age, not by a per-message TTL, so it runs
        // about once an hour (240 × 15s) rather than on every tick.
        if ticks.is_multiple_of(240) {
            if let Err(e) = purge_by_retention(&state).await {
                tracing::warn!(error = %e, "Purge de rétention chat échouée");
            }
        }
    }
}

/// Delete the rooms of drafts that were never finished.
///
/// A room attached to an event has to be created before the event is saved —
/// the link is what gets saved. Closing the form tells us to take it back, but
/// a refreshed page, a closed tab, a crash or a lost network tell us nothing at
/// all. So the room carries its own deadline and this is what reads it: no
/// message from the browser is required for the room to go away, which is the
/// whole point.
///
/// Guarded twice over: still provisional (the form never confirmed it), and
/// never used (nobody joined it, nobody wrote in it). A room someone walked
/// into is not a leftover, whatever happened to the form that made it.
async fn purge_provisional(st: &AppState) -> anyhow::Result<()> {
    // Portable form of the old aliased `DELETE ... c WHERE {UNUSED_ROOM}`: the
    // ids are collected first (a plain SELECT may correlate on the target table),
    // then deleted by an `IN (...)` (no alias, no correlation on the DELETE
    // target — what MySQL/SQLite refuse). The only interpolation is the
    // UNUSED_ROOM const; no request value is involved — this runs on a timer.
    let now = chrono::Utc::now();
    let ids: Vec<Uuid> = st
        .db
        .fetch_all_as::<(Uuid,)>(
            &format!(
                "SELECT id FROM chat.conversations
                  WHERE provisional_until IS NOT NULL
                    AND provisional_until < $1
                    AND {}",
                crate::handlers::conversations::UNUSED_ROOM
            ),
            params![now],
        )
        .await?
        .into_iter()
        .map(|(id,)| id)
        .collect();

    if ids.is_empty() {
        return Ok(());
    }
    let mut qb = DbQueryBuilder::new(st.db.backend(), "DELETE FROM chat.conversations WHERE id");
    qb.push_in(ids.iter().copied());
    let deleted = qb.execute(&st.db).await?;

    if deleted > 0 {
        tracing::info!(count = deleted, "Salles de réunion provisoires abandonnées supprimées");
    }
    Ok(())
}

/// Tombstone messages older than the instance retention window (`0` = keep
/// forever). The server never reads the ciphertext — it deletes it by age alone.
/// Bounded per run so a large backlog drains gradually.
async fn purge_by_retention(st: &AppState) -> anyhow::Result<()> {
    let days = st.instance().retention_days;
    if days <= 0 {
        return Ok(());
    }
    // Rows older than the retention window (cutoff computed in Rust — no
    // make_interval), collected then tombstoned by id. MySQL has no UPDATE ...
    // RETURNING, so the ids are taken by a bounded SELECT first.
    let now = chrono::Utc::now();
    let cutoff = now - chrono::Duration::days(days as i64);
    let purged: Vec<(Uuid, Uuid)> = st
        .db
        .fetch_all_as(
            "SELECT id, conversation_id FROM chat.messages
             WHERE created_at < $1 AND deleted_at IS NULL
             LIMIT 1000",
            params![cutoff],
        )
        .await?;

    if !purged.is_empty() {
        let ids: Vec<Uuid> = purged.iter().map(|(id, _)| *id).collect();
        let mut qb = DbQueryBuilder::new(
            st.db.backend(),
            "UPDATE chat.messages SET message_type = 'deleted', encrypted_data = '', deleted_at = ",
        );
        qb.push_bind(now).push(" WHERE id").push_in(ids);
        qb.execute(&st.db).await?;
    }

    for (id, conv_id) in purged {
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

/// Deliver scheduled messages whose time has come (clear scheduled_at, bump the
/// conversation, broadcast them like a fresh message).
async fn deliver_scheduled(st: &AppState) -> anyhow::Result<()> {
    // Collect the due messages, then clear scheduled_at by id (no UPDATE ...
    // RETURNING on MySQL). The in-memory copies have scheduled_at zeroed to match
    // what a client sees for a freshly delivered message.
    let now = chrono::Utc::now();
    let mut due: Vec<Message> = st
        .db
        .fetch_all_as(
            "SELECT * FROM chat.messages
             WHERE scheduled_at IS NOT NULL AND scheduled_at <= $1 AND deleted_at IS NULL",
            params![now],
        )
        .await?;

    if !due.is_empty() {
        let ids: Vec<Uuid> = due.iter().map(|m| m.id).collect();
        let mut qb =
            DbQueryBuilder::new(st.db.backend(), "UPDATE chat.messages SET scheduled_at = NULL WHERE id");
        qb.push_in(ids);
        qb.execute(&st.db).await?;
        for msg in &mut due {
            msg.scheduled_at = None;
        }
    }

    for msg in due {
        st.db
            .execute(
                "UPDATE chat.conversations SET updated_at = $1 WHERE id = $2",
                params![chrono::Utc::now(), msg.conversation_id],
            )
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
        crate::events::publisher::emit_new_message(st, &msg).await;
    }
    Ok(())
}

/// Tombstone ephemeral messages past their TTL and notify members.
async fn purge_expired(st: &AppState) -> anyhow::Result<()> {
    let now = chrono::Utc::now();
    let expired: Vec<(Uuid, Uuid)> = st
        .db
        .fetch_all_as(
            "SELECT id, conversation_id FROM chat.messages
             WHERE expires_at IS NOT NULL AND expires_at <= $1 AND deleted_at IS NULL",
            params![now],
        )
        .await?;

    if !expired.is_empty() {
        let ids: Vec<Uuid> = expired.iter().map(|(id, _)| *id).collect();
        let mut qb = DbQueryBuilder::new(
            st.db.backend(),
            "UPDATE chat.messages SET message_type = 'deleted', encrypted_data = '', deleted_at = ",
        );
        qb.push_bind(now).push(" WHERE id").push_in(ids);
        qb.execute(&st.db).await?;
    }

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
