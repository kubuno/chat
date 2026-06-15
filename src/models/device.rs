use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Device {
    pub id:               Uuid,
    pub user_id:          Uuid,
    pub device_name:      String,
    pub identity_key_pub: String,
    pub push_token:       Option<String>,
    pub push_platform:    Option<String>,
    pub last_seen_at:     DateTime<Utc>,
    pub created_at:       DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Presence {
    pub user_id:      Uuid,
    pub status:       String,
    pub custom_status: Option<String>,
    pub last_seen_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePresenceDto {
    pub status:        Option<String>,
    pub custom_status: Option<String>,
}
