use crate::errors::{ChatError, ChatResult};
use crate::models::user_key::{IdentityKey, OneTimePreKey, PreKeyBundle, SignedPreKey};
use kubuno_db::{params, DbPool};
use uuid::Uuid;

/// Compter les OPK libres d'un utilisateur
pub async fn count_free_opks(db: &DbPool, user_id: Uuid) -> ChatResult<i64> {
    // COUNT(*) is decoded as i64 through the dialect cast (a bare COUNT is a
    // different width per engine).
    let sql = format!(
        "SELECT {} FROM chat.one_time_prekeys WHERE user_id = $1 AND claimed_at IS NULL",
        db.backend().count_bigint("*")
    );
    let count: i64 = db.fetch_scalar(&sql, params![user_id]).await?;
    Ok(count)
}

/// Obtenir le bundle de prékeys d'un utilisateur (pour X3DH)
pub async fn get_prekey_bundle(db: &DbPool, user_id: Uuid) -> ChatResult<PreKeyBundle> {
    let ik: IdentityKey = db
        .fetch_optional_as("SELECT * FROM chat.identity_keys WHERE user_id = $1", params![user_id])
        .await?
        .ok_or_else(|| ChatError::NotFound(format!("Clés non trouvées pour {user_id}")))?;

    let spk: SignedPreKey = db
        .fetch_optional_as(
            "SELECT * FROM chat.signed_prekeys
             WHERE user_id = $1 AND expires_at > $2
             ORDER BY expires_at DESC LIMIT 1",
            params![user_id, chrono::Utc::now()],
        )
        .await?
        .ok_or_else(|| ChatError::NotFound("Aucune Signed PreKey valide".into()))?;

    // Claim one one-time prekey. The old single-statement `UPDATE ... WHERE id =
    // (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *` is not portable (no
    // RETURNING on MySQL, no SKIP-LOCKED semantics we can rely on across
    // engines). The portable claim is: pick the oldest free id, then a guarded
    // UPDATE whose success is proven by `rows_affected == 1`. A lost race simply
    // hands out no OPK for this bundle, which is acceptable (best effort).
    let opk: Option<OneTimePreKey> = {
        let mut tx = db.begin().await?;
        let picked: Option<Uuid> = tx
            .fetch_optional_scalar::<Uuid>(
                "SELECT id FROM chat.one_time_prekeys
                 WHERE user_id = $1 AND claimed_at IS NULL
                 ORDER BY created_at LIMIT 1",
                params![user_id],
            )
            .await?;
        let claimed_id = if let Some(id) = picked {
            let affected = tx
                .execute(
                    "UPDATE chat.one_time_prekeys SET claimed_at = $1, claimed_by = $2
                     WHERE id = $3 AND claimed_at IS NULL",
                    params![chrono::Utc::now(), user_id, id],
                )
                .await?;
            if affected == 1 {
                Some(id)
            } else {
                None
            }
        } else {
            None
        };
        tx.commit().await?;
        if let Some(id) = claimed_id {
            db.fetch_optional_as::<OneTimePreKey>(
                "SELECT * FROM chat.one_time_prekeys WHERE id = $1",
                params![id],
            )
            .await?
        } else {
            None
        }
    };

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
