use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Conversation {
    pub id:          Uuid,
    pub conv_type:   String,
    pub name:        Option<String>,
    pub description: Option<String>,
    pub avatar_path: Option<String>,
    pub user_a_id:   Option<Uuid>,
    pub user_b_id:   Option<Uuid>,
    pub created_by:  Option<Uuid>,
    pub created_at:  DateTime<Utc>,
    pub updated_at:  DateTime<Utc>,
    #[serde(default)]
    pub is_meeting:  bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ConversationMember {
    pub conversation_id:      Uuid,
    pub user_id:              Uuid,
    pub role:                 String,
    pub last_read_at:         DateTime<Utc>,
    pub last_read_message_id: Option<Uuid>,
    pub muted_until:          Option<DateTime<Utc>>,
    pub is_pinned:            bool,
    pub joined_at:            DateTime<Utc>,
    pub left_at:              Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct CreateConversationDto {
    pub conv_type:    Option<String>,
    pub target_user:  Option<Uuid>,
    pub name:         Option<String>,
    pub description:  Option<String>,
    pub member_ids:   Option<Vec<Uuid>>,
    pub is_meeting:   Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateConversationDto {
    pub name:        Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AddMembersDto {
    pub user_ids: Vec<Uuid>,
}

// Profil minimal de l'interlocuteur dans une conv directe
#[derive(Debug, Serialize)]
pub struct OtherUserInfo {
    pub id:           uuid::Uuid,
    pub display_name: Option<String>,
    pub username:     String,
    pub avatar_url:   Option<String>,
}

// Vue enrichie pour la liste des conversations (inclut unread_count + last message meta)
#[derive(Debug, Serialize)]
pub struct ConversationSummary {
    pub conversation:  Conversation,
    pub unread_count:  i64,
    /// True when anything (including one's own messages) postdates `last_read_at`.
    /// Needed by "mark as unread": a conversation with no message from anyone else
    /// would otherwise stay at unread_count = 0 and look untouched.
    pub is_unread:     bool,
    pub member_count:  i64,
    pub is_pinned:     bool,
    pub is_archived:   bool,
    pub is_favorite:   bool,
    pub muted_until:   Option<chrono::DateTime<chrono::Utc>>,
    pub other_user:    Option<OtherUserInfo>,   // renseigné uniquement pour les conv directes
}

#[derive(Debug, Deserialize)]
pub struct MemberSettingsDto {
    pub pin:         Option<bool>,
    pub archive:     Option<bool>,
    pub favorite:    Option<bool>,
    pub mute_until:  Option<chrono::DateTime<chrono::Utc>>,  // None = désactiver le mode silencieux
    pub unmute:      Option<bool>,
    pub mark_unread: Option<bool>,
}
