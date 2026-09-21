use crate::models::message::Message;
use crate::state::AppState;
use kubuno_db::params;
use serde_json::{json, Value};
use uuid::Uuid;

/// Publish an event to the core. On PostgreSQL this is `pg_notify`; on
/// MySQL/SQLite (no LISTEN/NOTIFY) it is a durable row in the module's event
/// outbox, which the core polls — both handled by `kubuno_db::events::notify`.
pub async fn publish_to_core(st: &AppState, event_type: &str, payload: Value) {
    let event = json!({
        "type":    event_type,
        "payload": payload,
        "module":  "chat",
    });
    let payload_str = event.to_string();
    kubuno_db::events::notify(&st.db, crate::SCHEMA, kubuno_db::events::CHANNEL, &payload_str)
        .await
        .map_err(|e| tracing::warn!(error = %e, event_type, "event publish failed"))
        .ok();
}

/// Publish a module-defined (`Custom`) event addressed to explicit recipients.
/// The core's push worker turns it into a push notification for every device
/// of those users (honouring their per-module preferences) and its WebSocket
/// hub delivers it to them only.
async fn publish_custom(st: &AppState, event_type: &str, payload: Value) {
    publish_to_core(
        st,
        "Custom",
        json!({ "event_type": event_type, "module_id": "chat", "payload": payload }),
    )
    .await;
}

pub async fn emit_message_sent(st: &AppState, chat_id: Uuid, from_user_id: Uuid) {
    publish_to_core(
        st,
        "MessageSent",
        json!({ "chat_id": chat_id, "from_user_id": from_user_id, "module_id": "chat" }),
    )
    .await;
}

/// Members of a conversation who should be woken up for something the given
/// user did: everyone still in it except that user, minus those who muted the
/// conversation and those in Do-Not-Disturb.
async fn notifiable_members(st: &AppState, conv_id: Uuid, actor_id: Uuid) -> Vec<Uuid> {
    st.db
        .fetch_all_as::<(Uuid,)>(
            "SELECT cm.user_id
             FROM chat.conversation_members cm
             LEFT JOIN chat.presence p ON p.user_id = cm.user_id
             WHERE cm.conversation_id = $1
               AND cm.left_at IS NULL
               AND cm.user_id <> $2
               AND (cm.muted_until IS NULL OR cm.muted_until <= $3)
               AND COALESCE(p.status, 'offline') <> 'dnd'
               AND COALESCE(p.manual_status, '') <> 'dnd'",
            params![conv_id, actor_id, chrono::Utc::now()],
        )
        .await
        .map_err(|e| tracing::error!(error = %e, %conv_id, "notifiable_members"))
        .unwrap_or_default()
        .into_iter()
        .map(|(id,)| id)
        .collect()
}

/// How a conversation and its author present themselves in a notification:
/// `(conversation name if it has one, author's display name)`. Neither is
/// message content: names are the only thing the server may put in a push.
async fn notification_names(st: &AppState, conv_id: Uuid, actor_id: Uuid) -> (Option<String>, String) {
    // NOTE: cross-schema lookup of core.users (PostgreSQL/MySQL only).
    st.db
        .fetch_optional_as::<(Option<String>, Option<String>)>(
            "SELECT NULLIF(c.name, ''), u.display_name
             FROM chat.conversations c
             LEFT JOIN core.users u ON u.id = $2
             WHERE c.id = $1",
            params![conv_id, actor_id],
        )
        .await
        .map_err(|e| tracing::error!(error = %e, %conv_id, "notification_names"))
        .ok()
        .flatten()
        .map(|(conv, who)| (conv, who.unwrap_or_else(|| "Un contact".to_string())))
        .unwrap_or((None, "Un contact".to_string()))
}

/// `chat.new_message`: a message became visible to the other members (sent
/// now, or delivered by the scheduler). The push carries WHO wrote, never
/// WHAT: the title is the sender (direct) or the group, the body is generic,
/// and `resource_id` is the conversation so a client can deep-link into it.
pub async fn emit_new_message(st: &AppState, msg: &Message) {
    let recipients = notifiable_members(st, msg.conversation_id, msg.sender_id).await;
    if recipients.is_empty() {
        return;
    }
    let (conv_name, sender_name) = notification_names(st, msg.conversation_id, msg.sender_id).await;
    let (title, body) = match conv_name {
        Some(group) => (group, format!("Nouveau message de {sender_name}")),
        None => (sender_name, "Nouveau message".to_string()),
    };
    publish_custom(
        st,
        "chat.new_message",
        json!({
            "recipient_user_ids": recipients,
            "title":              title,
            "body":               body,
            "resource_id":        msg.conversation_id,
            "conversation_id":    msg.conversation_id,
            "message_id":         msg.id,
            "sender_id":          msg.sender_id,
        }),
    )
    .await;
}

/// `chat.call_ring`: someone is calling a member of `room`. Lets a native
/// client show a full-screen incoming-call UI while the app is asleep; the
/// signalling itself (SDP/ICE) still only flows over the chat WebSocket.
pub async fn emit_call_ring(st: &AppState, room: Uuid, from_user_id: Uuid, to_user_id: Uuid, call_type: &str) {
    let allowed = notifiable_members(st, room, from_user_id).await;
    if !allowed.contains(&to_user_id) {
        return;
    }
    let (conv_name, caller) = notification_names(st, room, from_user_id).await;
    let body = if call_type == "video" { "Appel vidéo entrant" } else { "Appel entrant" };
    let body = match conv_name {
        Some(group) => format!("{body} de {caller} ({group})"),
        None => body.to_string(),
    };
    publish_custom(
        st,
        "chat.call_ring",
        json!({
            "recipient_user_ids": [to_user_id],
            "title":              caller,
            "body":               body,
            "resource_id":        room,
            "conversation_id":    room,
            "from_user_id":       from_user_id,
            "call_type":          call_type,
        }),
    )
    .await;
}

/// A meeting that belongs to a form elsewhere has been renamed here.
///
/// Addressed by the owner's own reference (`<module>:<id>`), not by our room id:
/// the module that owns the title knows what that string means, and we do not
/// have to know anything about its objects to tell it.
pub async fn emit_meeting_renamed(st: &AppState, owner_ref: &str, title: &str) {
    publish_custom(
        st,
        "chat.meeting_renamed",
        json!({ "owner": owner_ref, "title": title }),
    )
    .await;
}
