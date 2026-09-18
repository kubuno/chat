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
    /// Set when the meeting was ended for everyone: it can no longer be joined.
    #[serde(default)]
    pub meeting_ended_at: Option<DateTime<Utc>>,
    /// The host's decisions for this room — see `MeetingSettings`. Absent keys
    /// mean the permissive default, so a room created before they existed
    /// behaves exactly as it did.
    #[serde(default)]
    pub meeting_settings: serde_json::Value,
    /// Set while this room exists only for a form that has not been saved yet.
    /// It is nobody's room until the form is saved: it stays out of everyone's
    /// list, and it is swept away if the deadline passes without a word — see
    /// the `provisional` endpoints and the worker.
    #[serde(default)]
    pub provisional_until: Option<DateTime<Utc>>,
    /// What owns this room's title — an opaque `<module>:<id>` reference, or
    /// `None` for a meeting that names itself. See migration 000020.
    #[serde(default)]
    pub linked_ref: Option<String>,
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
    /// Ask for a room that belongs to a draft: created now because a link has
    /// to exist before the form that carries it can be saved, and thrown away
    /// on its own if that form never is.
    pub provisional:  Option<bool>,
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
    pub other_user:    Option<OtherUserInfo>,   // only set for direct conversations
    /// Newest message the caller may see (none in an empty or fully hidden
    /// conversation). Lets a client render a preview per row in one request.
    pub last_message:  Option<LastMessagePreview>,
}

#[derive(Debug, Serialize)]
pub struct LastMessagePreview {
    pub id:             Uuid,
    pub sender_id:      Uuid,
    pub message_type:   String,
    /// Same opaque envelope as in the message list; the client decodes it.
    pub encrypted_data: String,
    pub created_at:     chrono::DateTime<chrono::Utc>,
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

/// What a host may decide about a meeting, ahead of it.
///
/// Every switch here is ENFORCED somewhere — three of them by this server, one
/// by the meeting page. A switch that changed nothing would be worse than an
/// absent one: it would tell a host their meeting is moderated when it is not.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MeetingSettings {
    /// The master switch. Off (the default) means the room is wide open and
    /// the three switches below are not consulted at all.
    #[serde(default)]
    pub host_management: bool,
    /// May a guest share their screen? Enforced by the meeting page: the media
    /// is peer-to-peer, so there is no server in the path to refuse it.
    #[serde(default = "yes")]
    pub allow_screen_share: bool,
    /// May a guest send a reaction? Same place, same reason.
    #[serde(default = "yes")]
    pub allow_reactions: bool,
    /// May a guest write in the meeting's chat? Enforced HERE, on the send.
    #[serde(default = "yes")]
    pub allow_messages: bool,
    /// Must the host be in the room before anyone else may enter? Enforced
    /// HERE, on the join.
    #[serde(default)]
    pub host_joins_first: bool,
    /// Who the link lets in. `open`: whoever holds it walks in — what a link
    /// has always meant here. `trusted`: only people the host already put in
    /// the room; anyone else is refused, or may ASK when `allow_knocking` is
    /// on. Enforced HERE, on the join.
    #[serde(default = "open_access")]
    pub access_type: String,
    /// In `trusted`, may a stranger holding the link ask to be let in?
    #[serde(default = "yes")]
    pub allow_knocking: bool,
    /// May a guest LAUNCH an activity in the meeting — a file put in front of
    /// everyone, a board — or only the host? Enforced by the room: an activity
    /// is run in the browser that launches it.
    #[serde(default = "yes")]
    pub allow_participant_activities: bool,
    /// May another module of this instance obtain the meeting's audio and
    /// video? Enforced at the single door that hands it over (`meetingMedia`).
    #[serde(default = "yes")]
    pub allow_media_capture: bool,
    /// Start recording as soon as someone who may record is in the room.
    /// Off by default, and deliberately: a meeting that records itself without
    /// anyone deciding to is not something to fall into.
    #[serde(default)]
    pub auto_record: bool,
}

fn open_access() -> String { "open".into() }

fn yes() -> bool { true }

impl Default for MeetingSettings {
    fn default() -> Self {
        Self {
            host_management: false,
            allow_screen_share: true,
            allow_reactions: true,
            allow_messages: true,
            host_joins_first: false,
            access_type: open_access(),
            allow_knocking: true,
            allow_participant_activities: true,
            allow_media_capture: true,
            auto_record: false,
        }
    }
}

impl MeetingSettings {
    /// Read them off a conversation row. Anything unreadable falls back to the
    /// permissive default: a corrupt blob must not lock a meeting shut.
    pub fn read(v: &serde_json::Value) -> Self {
        serde_json::from_value(v.clone()).unwrap_or_default()
    }
    /// A restriction only applies when the host asked for moderation at all.
    pub fn restricts(&self) -> bool { self.host_management }
    /// True when the link alone is not enough to walk in.
    pub fn trusted_only(&self) -> bool { self.restricts() && self.access_type == "trusted" }
}
