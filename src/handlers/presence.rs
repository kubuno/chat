use crate::errors::{ChatError, ChatResult};
use crate::middleware::ChatUser;
use crate::models::device::{Presence, UpdatePresenceDto};
use crate::services::websocket_hub::{WsEnvelope, WsEvent};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

/// Statuses accepted by the presence CHECK constraint.
const VALID_STATUSES: [&str; 4] = ["online", "away", "dnd", "offline"];
const MAX_CUSTOM_STATUS: usize = 100;

/// GET /presence/:user_id — statut de présence d'un utilisateur
pub async fn get_presence(
    State(st): State<AppState>,
    _user: ChatUser,
    Path(target_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    let presence: Option<Presence> =
        sqlx::query_as("SELECT * FROM chat.presence WHERE user_id = $1")
            .bind(target_id)
            .fetch_optional(&st.db)
            .await?;

    Ok(Json(json!({
        "presence": presence.unwrap_or(Presence {
            user_id:      target_id,
            status:       "offline".into(),
            custom_status: None,
            manual_status: None,
            last_seen_at: chrono::Utc::now(),
        })
    })))
}

/// PATCH /presence — mettre à jour son propre statut
pub async fn update_presence(
    State(st): State<AppState>,
    user: ChatUser,
    Json(dto): Json<UpdatePresenceDto>,
) -> ChatResult<Json<Value>> {
    let status = dto.status.as_deref().unwrap_or("online");

    // Validate before touching the DB — the CHECK constraint would otherwise
    // surface as an opaque 500.
    if !VALID_STATUSES.contains(&status) {
        return Err(ChatError::Validation(format!("Statut invalide: {status}")));
    }
    let custom = dto.custom_status.as_deref().map(str::trim).filter(|s| !s.is_empty());
    if custom.map(|c| c.chars().count() > MAX_CUSTOM_STATUS).unwrap_or(false) {
        return Err(ChatError::Validation("Statut personnalisé trop long".into()));
    }

    // `manual_status` remembers a deliberate Away/DND so a WebSocket reconnect
    // (which flips `status` back to 'online') doesn't silently undo it.
    let manual = if status == "away" || status == "dnd" { Some(status) } else { None };

    sqlx::query(
        "INSERT INTO chat.presence (user_id, status, custom_status, manual_status, last_seen_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET status = EXCLUDED.status,
             custom_status = EXCLUDED.custom_status,
             manual_status = EXCLUDED.manual_status,
             last_seen_at = NOW()",
    )
    .bind(user.id)
    .bind(status)
    .bind(custom)
    .bind(manual)
    .execute(&st.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "update_presence");
        e
    })?;

    // Tell the user's contacts about it — without this, a status picked by hand
    // would only show up after they reload.
    broadcast_presence(&st, user.id, status, custom).await;

    Ok(Json(json!({ "ok": true, "status": status, "custom_status": custom })))
}

/// Push a presence change to everyone this user has a direct conversation with.
async fn broadcast_presence(st: &AppState, user_id: Uuid, status: &str, custom: Option<&str>) {
    let contacts: Vec<Uuid> = match sqlx::query_scalar(
        "SELECT DISTINCT
             CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END
         FROM chat.conversations
         WHERE conv_type = 'direct' AND (user_a_id = $1 OR user_b_id = $1)",
    )
    .bind(user_id)
    .fetch_all(&st.db)
    .await
    {
        Ok(rows) => rows,
        Err(e) => {
            tracing::error!(error = %e, "broadcast_presence: contacts");
            return;
        }
    };

    let env = WsEnvelope {
        event: WsEvent::PresenceUpdate,
        payload: json!({ "user_id": user_id, "status": status, "custom_status": custom }),
    };
    st.ws_hub.send_to_many(&contacts, env, None).await;
}
