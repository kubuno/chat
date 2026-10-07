use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct IdentityKey {
    pub user_id:          Uuid,
    pub identity_key_pub: String,
    pub fingerprint:      String,
    pub created_at:       DateTime<Utc>,
    pub updated_at:       DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SignedPreKey {
    pub id:         Uuid,
    pub user_id:    Uuid,
    pub key_id:     i32,
    pub public_key: String,
    pub signature:  String,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct OneTimePreKey {
    pub id:         Uuid,
    pub user_id:    Uuid,
    pub key_id:     i32,
    pub public_key: String,
    pub claimed_at: Option<DateTime<Utc>>,
    pub claimed_by: Option<Uuid>,
    pub created_at: DateTime<Utc>,
}

/// Bundle de clés publiques d'un utilisateur (pour X3DH)
#[derive(Debug, Serialize)]
pub struct PreKeyBundle {
    pub user_id:            Uuid,
    pub identity_key_pub:   String,
    pub fingerprint:        String,
    pub signed_prekey_id:   i32,
    pub signed_prekey_pub:  String,
    pub signed_prekey_sig:  String,
    pub one_time_prekey_id:  Option<i32>,
    pub one_time_prekey_pub: Option<String>,
    /// Nombre d'OPK restantes (pour déclencher un rechargement côté client)
    pub opk_count:          i64,
}

#[derive(Debug, Deserialize)]
pub struct SignedPreKeyDto {
    pub id:         i32,
    pub public_key: String,
    pub signature:  String,
}

#[derive(Debug, Deserialize)]
pub struct OneTimePreKeyDto {
    pub id:         i32,
    pub public_key: String,
}

#[derive(Debug, Deserialize)]
pub struct RegisterKeysDto {
    pub identity_key_pub:  String,
    pub fingerprint:       String,
    pub signed_prekey:     SignedPreKeyDto,
    pub one_time_prekeys:  Vec<OneTimePreKeyDto>,
}

#[derive(Debug, Deserialize)]
pub struct UploadOneTimePreKeysDto {
    pub one_time_prekeys: Vec<OneTimePreKeyDto>,
}
