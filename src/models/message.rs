use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Message {
    pub id:              Uuid,
    pub conversation_id: Uuid,
    pub sender_id:       Uuid,
    pub encrypted_data:  String,
    pub message_type:    String,
    pub media_meta:      Option<Value>,
    pub reply_to_id:     Option<Uuid>,
    pub status:          String,
    pub edited_at:       Option<DateTime<Utc>>,
    pub deleted_at:      Option<DateTime<Utc>>,
    pub nonce:           String,
    pub sequence_num:    i64,
    pub created_at:      DateTime<Utc>,
    #[serde(default)]
    pub is_pinned:       bool,
    #[serde(default)]
    pub pinned_at:       Option<DateTime<Utc>>,
    #[serde(default)]
    pub scheduled_at:    Option<DateTime<Utc>>,
    #[serde(default)]
    pub expires_at:      Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MessageReaction {
    pub message_id: Uuid,
    pub user_id:    Uuid,
    pub emoji:      String,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageDto {
    pub encrypted_data: String,
    pub message_type:   Option<String>,
    pub media_meta:     Option<Value>,
    pub reply_to_id:    Option<Uuid>,
    pub nonce:          String,
    /// Header du ratchet (métadonnées pour le destinataire — ne pas lire côté serveur)
    pub ratchet_header: Option<Value>,
    /// ID de la OPK utilisée (pour que le serveur la marque claimed)
    pub used_opk_id:    Option<Uuid>,
    /// Clé publique éphémère X3DH (premier message d'une session)
    pub ephemeral_key:  Option<String>,
    /// ID clé d'identité publique de l'expéditeur
    pub sender_ik_pub:  Option<String>,
    /// Envoi programmé (futur) — le message reste invisible aux autres jusqu'à l'échéance.
    pub scheduled_at:   Option<DateTime<Utc>>,
    /// Message éphémère : durée de vie en secondes (auto-suppression après).
    pub expires_in_secs: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct VoteDto {
    pub option_index: i32,
}

#[derive(Debug, Deserialize)]
pub struct EditMessageDto {
    pub encrypted_data: String,
    pub nonce:          String,
}

#[derive(Debug, Deserialize)]
pub struct ReadReceiptDto {
    pub up_to_message_id: Uuid,
}

#[derive(Debug, Deserialize)]
pub struct ReactionDto {
    pub emoji: String,
}
