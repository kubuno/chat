use crate::errors::{ChatError, ChatResult};
use crate::models::user_key::{IdentityKey, OneTimePreKey, PreKeyBundle, SignedPreKey};
use sqlx::PgPool;
use uuid::Uuid;

/// Compter les OPK libres d'un utilisateur
pub async fn count_free_opks(db: &PgPool, user_id: Uuid) -> ChatResult<i64> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM chat.one_time_prekeys
         WHERE user_id = $1 AND claimed_at IS NULL",
    )
    .bind(user_id)
    .fetch_one(db)
    .await?;
    Ok(count)
}

/// Obtenir le bundle de prékeys d'un utilisateur (pour X3DH)
pub async fn get_prekey_bundle(db: &PgPool, user_id: Uuid) -> ChatResult<PreKeyBundle> {
    let ik = sqlx::query_as::<_, IdentityKey>(
        "SELECT * FROM chat.identity_keys WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| ChatError::NotFound(format!("Clés non trouvées pour {user_id}")))?;

    let spk = sqlx::query_as::<_, SignedPreKey>(
        "SELECT * FROM chat.signed_prekeys
         WHERE user_id = $1 AND expires_at > NOW()
         ORDER BY expires_at DESC LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(db)
    .await?
    .ok_or_else(|| ChatError::NotFound("Aucune Signed PreKey valide".into()))?;

    // Prendre une OPK (SKIP LOCKED pour éviter les concurrences)
    let opk: Option<OneTimePreKey> = sqlx::query_as(
        "UPDATE chat.one_time_prekeys
         SET claimed_at = NOW()
         WHERE id = (
             SELECT id FROM chat.one_time_prekeys
             WHERE user_id = $1 AND claimed_at IS NULL
             ORDER BY created_at
             LIMIT 1
             FOR UPDATE SKIP LOCKED
         )
         RETURNING *",
    )
    .bind(user_id)
    .fetch_optional(db)
    .await?;

    let opk_count = count_free_opks(db, user_id).await?;

    Ok(PreKeyBundle {
        user_id,
        identity_key_pub:    ik.identity_key_pub,
        fingerprint:         ik.fingerprint,
        signed_prekey_id:    spk.key_id,
        signed_prekey_pub:   spk.public_key,
        signed_prekey_sig:   spk.signature,
        one_time_prekey_id:  opk.as_ref().map(|o| o.key_id),
        one_time_prekey_pub: opk.map(|o| o.public_key),
        opk_count,
    })
}
