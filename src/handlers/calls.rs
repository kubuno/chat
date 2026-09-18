use crate::errors::{ChatError, ChatResult};
use crate::middleware::ChatUser;
use crate::services::websocket_hub::{WsEnvelope, WsEvent};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct RateCallDto {
    /// How the call sounded and looked, from 1 (very poor) to 5 (very good).
    pub rating: i16,
}

/// POST /conversations/:id/call-rating — rate the quality of a call one has left.
///
/// Asked on the screen shown after leaving. Rating again replaces the previous
/// answer, so a second click is a correction rather than a duplicate.
pub async fn rate_call(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
    Json(dto): Json<RateCallDto>,
) -> ChatResult<Json<Value>> {
    if !(1..=5).contains(&dto.rating) {
        return Err(ChatError::Validation("Note invalide".into()));
    }

    // Only someone who belongs to the call can rate it.
    let is_member: bool = sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM chat.conversation_members
             WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL
         )",
    )
    .bind(conv_id)
    .bind(user.id)
    .fetch_one(&st.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "call rating: appartenance illisible");
        ChatError::Database(e)
    })?;
    if !is_member {
        return Err(ChatError::Forbidden);
    }

    sqlx::query(
        "INSERT INTO chat.call_ratings (conversation_id, user_id, rating)
         VALUES ($1, $2, $3)
         ON CONFLICT (conversation_id, user_id)
         DO UPDATE SET rating = EXCLUDED.rating, created_at = NOW()",
    )
    .bind(conv_id)
    .bind(user.id)
    .bind(dto.rating)
    .execute(&st.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "call rating: écriture impossible");
        ChatError::Database(e)
    })?;

    Ok(Json(json!({ "ok": true })))
}

/// POST /conversations/:id/end-meeting — end a meeting for everyone.
///
/// A peer-to-peer signal alone is not enough: a client that missed it would
/// stay in a meeting that is over, and anyone could walk back in through the
/// link. The room is therefore marked as ended here, which closes the door,
/// and every member is told over their own connection. Only whoever holds the
/// meeting may do it.
pub async fn end_meeting(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    let row: Option<(bool, Option<Uuid>)> = sqlx::query_as(
        "SELECT is_meeting, created_by FROM chat.conversations WHERE id = $1",
    )
    .bind(conv_id)
    .fetch_optional(&st.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "fin de réunion: conversation illisible");
        ChatError::Database(e)
    })?;
    let Some((is_meeting, created_by)) = row else { return Err(ChatError::NotFound("Réunion introuvable".into())) };
    if !is_meeting {
        return Err(ChatError::Validation("Cette conversation n'est pas une réunion".into()));
    }

    // Whoever opened the room holds it; so does anyone the room made an owner
    // or an administrator.
    let role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM chat.conversation_members
         WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL",
    )
    .bind(conv_id)
    .bind(user.id)
    .fetch_optional(&st.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "fin de réunion: rôle illisible");
        ChatError::Database(e)
    })?;
    let is_host = created_by == Some(user.id)
        || matches!(role.as_deref(), Some("owner") | Some("admin"));
    if !is_host {
        return Err(ChatError::Forbidden);
    }

    sqlx::query("UPDATE chat.conversations SET meeting_ended_at = NOW() WHERE id = $1")
        .bind(conv_id)
        .execute(&st.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "fin de réunion: écriture impossible");
            ChatError::Database(e)
        })?;

    // Told to everyone, over their own connection: a client that missed the
    // direct signal still leaves.
    let members: Vec<Uuid> = sqlx::query_scalar(
        "SELECT user_id FROM chat.conversation_members
         WHERE conversation_id = $1 AND left_at IS NULL",
    )
    .bind(conv_id)
    .fetch_all(&st.db)
    .await
    .unwrap_or_default();
    let env = WsEnvelope {
        event:   WsEvent::CallSignal,
        payload: json!({
            "from_user_id": user.id,
            "signal": { "type": "call_end", "room": conv_id },
        }),
    };
    st.ws_hub.send_to_many(&members, env, Some(user.id)).await;

    Ok(Json(json!({ "ok": true })))
}

