use crate::errors::{ChatError, ChatResult};
use crate::middleware::ChatUser;
use crate::models::user_key::{RegisterKeysDto, UploadOneTimePreKeysDto};
use crate::services::key_service;
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use kubuno_db::dialect::{Assign, SqlType};
use kubuno_db::{new_id, params};
use serde_json::{json, Value};
use uuid::Uuid;

/// POST /keys/register — enregistrer les clés publiques (premier lancement)
pub async fn register_keys(
    State(st): State<AppState>,
    user: ChatUser,
    Json(dto): Json<RegisterKeysDto>,
) -> ChatResult<Json<Value>> {
    let backend = st.db.backend();

    // Insert or update the identity key. `updated_at` is bound (NOW() has no
    // portable literal), and the upsert clause is spelled per engine.
    let upsert = backend.upsert(
        "chat.identity_keys",
        &["user_id"],
        &[
            Assign::Incoming("identity_key_pub"),
            Assign::Incoming("fingerprint"),
            Assign::Incoming("updated_at"),
        ],
    );
    st.db
        .execute(
            &format!(
                "INSERT INTO chat.identity_keys (user_id, identity_key_pub, fingerprint, updated_at)
                 VALUES ($1, $2, $3, $4){upsert}"
            ),
            params![user.id, &dto.identity_key_pub, &dto.fingerprint, chrono::Utc::now()],
        )
        .await?;

    // Signed PreKey — inserted once, ignored if that (user, key_id) already exists.
    let ignore_spk = backend.on_conflict_do_nothing(&["user_id", "key_id"]);
    st.db
        .execute(
            &format!(
                "INSERT {}INTO chat.signed_prekeys (id, user_id, key_id, public_key, signature, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6){ignore_spk}",
                backend.insert_ignore_prefix()
            ),
            params![
                new_id(),
                user.id,
                dto.signed_prekey.id,
                &dto.signed_prekey.public_key,
                &dto.signed_prekey.signature,
                // Signed prekeys previously defaulted to NOW() + 7 days in SQL;
                // computed in Rust to stay portable.
                chrono::Utc::now() + chrono::Duration::days(7)
            ],
        )
        .await?;

    // One-Time PreKeys
    let ignore_opk = backend.on_conflict_do_nothing(&["user_id", "key_id"]);
    for opk in &dto.one_time_prekeys {
        st.db
            .execute(
                &format!(
                    "INSERT {}INTO chat.one_time_prekeys (id, user_id, key_id, public_key)
                     VALUES ($1, $2, $3, $4){ignore_opk}",
                    backend.insert_ignore_prefix()
                ),
                params![new_id(), user.id, opk.id, &opk.public_key],
            )
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
    let backend = st.db.backend();

    // Vérifier que la clé d'identité existe (cast the probe to a portable width).
    let exists: Option<i64> = st
        .db
        .fetch_optional_scalar(
            &format!(
                "SELECT {} FROM chat.identity_keys WHERE user_id = $1 LIMIT 1",
                backend.cast("1", SqlType::BigInt)
            ),
            params![user.id],
        )
        .await?;

    if exists.is_none() {
        return Err(ChatError::Validation(
            "Enregistrez d'abord votre clé d'identité".into(),
        ));
    }

    let ignore_opk = backend.on_conflict_do_nothing(&["user_id", "key_id"]);
    let mut inserted = 0i64;
    for opk in &dto.one_time_prekeys {
        let affected = st
            .db
            .execute(
                &format!(
                    "INSERT {}INTO chat.one_time_prekeys (id, user_id, key_id, public_key)
                     VALUES ($1, $2, $3, $4){ignore_opk}",
                    backend.insert_ignore_prefix()
                ),
                params![new_id(), user.id, opk.id, &opk.public_key],
            )
            .await?;
        inserted += affected as i64;
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
