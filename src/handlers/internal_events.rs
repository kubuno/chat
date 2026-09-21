//! Core → module event delivery (the `/ipc/events` receiver).
//!
//! The core POSTs every subscribed event here as the bare `AppEvent`
//! (`{ "type": …, "payload": { … } }`), guarded by `X-Internal-Secret`.
//!
//! This module acts on one of them: a form elsewhere — a calendar event today,
//! a task tomorrow — telling us that a meeting of ours belongs to it, and what
//! it is called. The title of an attached meeting is not its own: it is the
//! title of the thing the meeting exists for, and a rename in one place has to
//! be the name read in the other.
//!
//! A malformed payload is dropped with `200 ok`, never rejected: the core
//! retries a failure up to five times, and no retry can fix a producer's
//! mistake.

use axum::{extract::State, Json};
use kubuno_db::params;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{errors::ChatResult, state::AppState};

/// The envelope every delivered event arrives in.
#[derive(Deserialize)]
pub struct KubunoEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub payload:    Value,
}

/// "This meeting is mine, and here is what it is called."
#[derive(Deserialize)]
struct MeetingLink {
    /// The link as the owning form stores it. WE parse it, because we are the
    /// ones who know the shape of our own room addresses — the other module
    /// only ever handles an opaque string.
    url:   String,
    title: String,
    /// `<module>:<id>` of the thing that owns the title, or `null` when it has
    /// let the meeting go (the call was taken off it, or it was deleted).
    #[serde(default)]
    owner: Option<String>,
}

const MEETING_LINK: &str = "calendar.meeting_link";

/// The room id inside one of our own links, if that is what this is.
///
/// Accepts the path as stored (`/chat/meet/<id>`) and the absolute address a
/// person may have pasted; anything else is somebody else's link and is left
/// alone.
fn room_of(url: &str) -> Option<Uuid> {
    let tail = url.split("/chat/meet/").nth(1)?;
    let id = tail.split(['/', '?', '#']).next()?;
    Uuid::parse_str(id).ok()
}

/// Handles one delivered event.
pub async fn handle_event(
    State(state): State<AppState>,
    Json(event): Json<KubunoEvent>,
) -> ChatResult<Json<Value>> {
    // Only `Custom` carries a module's own event; its real name is inside.
    if event.event_type != "Custom" {
        return Ok(Json(json!({ "ok": true })));
    }
    if event.payload.get("event_type").and_then(Value::as_str) != Some(MEETING_LINK) {
        return Ok(Json(json!({ "ok": true })));
    }
    let body = match event.payload.get("payload") {
        Some(p) => p.clone(),
        None    => return Ok(Json(json!({ "ok": true }))),
    };
    let link: MeetingLink = match serde_json::from_value(body) {
        Ok(v)  => v,
        Err(e) => {
            tracing::warn!(error = %e, "meeting_link: charge utile illisible, ignorée");
            return Ok(Json(json!({ "ok": true })));
        }
    };
    let Some(room) = room_of(&link.url) else {
        return Ok(Json(json!({ "ok": true })));   // un lien qui n'est pas des nôtres
    };

    // Written in one statement, and ONLY when something actually differs. That
    // is what stops the two modules from renaming each other for ever: an
    // update that changes nothing touches no row, so nothing is announced back.
    //
    // Portable form of the old PostgreSQL version: no `RETURNING` (whether a row
    // changed is `rows_affected > 0`), and `IS DISTINCT FROM` — absent on MySQL —
    // is expanded into an explicit null-safe difference. Placeholders are strictly
    // increasing and never reused, so each reference of `title`/`owner` is bound
    // again (updated_at is bound too, NOW() has no portable literal).
    let title = link.title.trim();
    let now = chrono::Utc::now();
    let changed = state
        .db
        .execute(
            "UPDATE chat.conversations
                SET name       = COALESCE(NULLIF($1, ''), name),
                    linked_ref = $2,
                    updated_at = $3
              WHERE id = $4
                AND is_meeting
                AND ( ( (name IS NULL) <> (NULLIF($5, '') IS NULL) OR name <> NULLIF($6, '') )
                   OR ( (linked_ref IS NULL) <> ($7 IS NULL) OR linked_ref <> $8 ) )",
            params![title, link.owner.as_deref(), now, room, title, title, link.owner.as_deref(), link.owner.as_deref()],
        )
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "meeting_link: mise à jour de la salle");
            e
        })?
        > 0;

    if changed {
        tracing::info!(%room, owner = ?link.owner, "Salle de réunion liée à un formulaire");
    }
    Ok(Json(json!({ "ok": true })))
}
