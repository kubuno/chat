use crate::errors::{ChatError, ChatResult};
use crate::middleware::ChatUser;
use crate::models::user_key::{RegisterKeysDto, UploadOneTimePreKeysDto};
use crate::services::key_service;
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::{json, Value};
use uuid::Uuid;

/// POST /keys/register — enregistrer les clés publiques (premier lancement)
pub async fn register_keys(
    State(st): State<AppState>,
    user: ChatUser,
    Json(dto): Json<RegisterKeysDto>,
) -> ChatResult<Json<Value>> {
    // Insérer ou mettre à jour la clé d'identité
    sqlx::query(
        "INSERT INTO chat.identity_keys (user_id, identity_key_pub, fingerprint)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE
         SET identity_key_pub = EXCLUDED.identity_key_pub,
             fingerprint      = EXCLUDED.fingerprint,
             updated_at       = NOW()",
    )
    .bind(user.id)
    .bind(&dto.identity_key_pub)
    .bind(&dto.fingerprint)
    .execute(&st.db)
    .await?;

    // Signed PreKey
    sqlx::query(
        "INSERT INTO chat.signed_prekeys (user_id, key_id, public_key, signature)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, key_id) DO NOTHING",
    )
    .bind(user.id)
    .bind(dto.signed_prekey.id)
    .bind(&dto.signed_prekey.public_key)
    .bind(&dto.signed_prekey.signature)
    .execute(&st.db)
    .await?;

    // One-Time PreKeys
    for opk in &dto.one_time_prekeys {
        sqlx::query(
            "INSERT INTO chat.one_time_prekeys (user_id, key_id, public_key)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, key_id) DO NOTHING",
        )
        .bind(user.id)
        .bind(opk.id)
        .bind(&opk.public_key)
        .execute(&st.db)
        .await?;
    }

    tracing::info!(user_id = %user.id, opk_count = dto.one_time_prekeys.len(), "Clés enregistrées");
    Ok(Json(json!({ "ok": true })))
}

/// GET /keys/:user_id — bundle de prékeys pour X3DH
pub async fn get_prekey_bundle(
    State(st): State<AppState>,
    _user: ChatUser,
    Path(target_user_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    let bundle = key_service::get_prekey_bundle(&st.db, target_user_id).await?;
    Ok(Json(serde_json::to_value(bundle).map_err(anyhow::Error::from)?))
}

/// POST /keys/one-time — uploader de nouvelles OPK
pub async fn upload_one_time_prekeys(
    State(st): State<AppState>,
    user: ChatUser,
    Json(dto): Json<UploadOneTimePreKeysDto>,
) -> ChatResult<Json<Value>> {
    // Vérifier que la clé d'identité existe
    let exists: Option<i32> = sqlx::query_scalar(
        "SELECT 1 FROM chat.identity_keys WHERE user_id = $1",
    )
    .bind(user.id)
    .fetch_optional(&st.db)
    .await?;

    if exists.is_none() {
        return Err(ChatError::Validation(
            "Enregistrez d'abord votre clé d'identité".into(),
        ));
    }

    let mut inserted = 0i64;
    for opk in &dto.one_time_prekeys {
        let r = sqlx::query(
            "INSERT INTO chat.one_time_prekeys (user_id, key_id, public_key)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, key_id) DO NOTHING",
        )
        .bind(user.id)
        .bind(opk.id)
        .bind(&opk.public_key)
        .execute(&st.db)
        .await?;
        inserted += r.rows_affected() as i64;
    }

    let remaining = key_service::count_free_opks(&st.db, user.id).await?;
    Ok(Json(json!({ "ok": true, "inserted": inserted, "remaining": remaining })))
}

/// GET /keys/status — niveau du pool OPK
pub async fn key_status(
    State(st): State<AppState>,
    user: ChatUser,
) -> ChatResult<Json<Value>> {
    let opk_count = key_service::count_free_opks(&st.db, user.id).await?;
    let needs_refill = opk_count < st.settings.chat.opk_pool_min as i64;
    Ok(Json(json!({
        "opk_count":     opk_count,
        "needs_refill":  needs_refill,
        "min_threshold": st.settings.chat.opk_pool_min,
    })))
}
