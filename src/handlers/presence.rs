use crate::errors::ChatResult;
use crate::middleware::ChatUser;
use crate::models::device::{Presence, UpdatePresenceDto};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

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

    sqlx::query(
        "INSERT INTO chat.presence (user_id, status, custom_status, last_seen_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET status = EXCLUDED.status,
             custom_status = EXCLUDED.custom_status,
             last_seen_at = NOW()",
    )
    .bind(user.id)
    .bind(status)
    .bind(&dto.custom_status)
    .execute(&st.db)
    .await?;

    Ok(Json(json!({ "ok": true, "status": status })))
}
