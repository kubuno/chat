use crate::config::instance::{SpaceCreation, SpaceInvitePolicy};
use crate::errors::{ChatError, ChatResult};
use crate::middleware::ChatUser;
use crate::models::conversation::{
    AddMembersDto, Conversation, ConversationSummary, CreateConversationDto, LastMessagePreview,
    MemberSettingsDto, OtherUserInfo, UpdateConversationDto,
};
use crate::services::message_service;
use crate::services::websocket_hub::{WsEnvelope, WsEvent};
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    Json,
};
use kubuno_db::dialect::{Assign, SqlType};
use kubuno_db::{new_id, params, DbPool, DbQueryBuilder};
use serde_json::{json, Value};
use uuid::Uuid;

/// The floor used where PostgreSQL wrote `'-infinity'::timestamptz`: a fixed
/// early instant that predates every message, bound rather than spelled in SQL.
fn epoch_floor() -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::from_timestamp(0, 0).unwrap_or_else(chrono::Utc::now)
}

/// GET /conversations — liste des conversations de l'utilisateur
///
/// One aggregated query instead of ~5 per conversation: the list is refetched
/// often (WebSocket events, actions), so the N+1 shape was the hot path.
///
/// Provisional rooms are left out: a room that exists only because a form is
/// open is not yet a meeting anyone has, and showing it would put a half-written
/// event in the meetings list — where the only thing to do about it would be to
/// delete something the person never knowingly created.
pub async fn list_conversations(
    State(st): State<AppState>,
    user: ChatUser,
) -> ChatResult<Json<Value>> {
    #[derive(sqlx::FromRow)]
    struct SummaryRow {
        #[sqlx(flatten)]
        conv:           Conversation,
        unread_count:   i64,
        marked_unread:  bool,
        member_count:   i64,
        is_pinned:      bool,
        is_archived:    bool,
        is_favorite:    bool,
        muted_until:    Option<chrono::DateTime<chrono::Utc>>,
        other_id:       Option<Uuid>,
        other_name:     Option<String>,
        other_username: Option<String>,
        other_avatar:   Option<String>,
        lm_id:          Option<Uuid>,
        lm_sender_id:   Option<Uuid>,
        lm_type:        Option<String>,
        lm_data:        Option<String>,
        lm_created_at:  Option<chrono::DateTime<chrono::Utc>>,
    }

    // NOTE: cross-schema join to core.users (PostgreSQL/MySQL only). The old
    // `LEFT JOIN LATERAL (...)` — unsupported by MariaDB/SQLite — is replaced by a
    // correlated scalar subquery that picks the last visible message id, joined
    // back to its row; `'-infinity'::timestamptz` becomes a bound floor. Every
    // reference of the caller id / now is a distinct, strictly increasing
    // placeholder (sql::prepare forbids reuse).
    let now = chrono::Utc::now();
    let floor = epoch_floor();
    let rows = st
        .db
        .fetch_all_as::<SummaryRow>(
            "SELECT c.*,
                    m.marked_unread, m.is_pinned, m.is_archived, m.is_favorite, m.muted_until,
                    (SELECT COUNT(*) FROM chat.messages msg
                     WHERE msg.conversation_id = c.id
                       AND msg.sender_id != $1
                       AND msg.created_at > m.last_read_at
                       AND msg.deleted_at IS NULL)                           AS unread_count,
                    (SELECT COUNT(*) FROM chat.conversation_members cm
                     WHERE cm.conversation_id = c.id AND cm.left_at IS NULL) AS member_count,
                    u.id AS other_id, u.display_name AS other_name,
                    u.username AS other_username, u.avatar_url AS other_avatar,
                    lm.id AS lm_id, lm.sender_id AS lm_sender_id, lm.message_type AS lm_type,
                    lm.encrypted_data AS lm_data, lm.created_at AS lm_created_at
             FROM chat.conversations c
             JOIN chat.conversation_members m
               ON m.conversation_id = c.id AND m.user_id = $2 AND m.left_at IS NULL
             LEFT JOIN core.users u
               ON c.conv_type = 'direct'
              AND u.id = CASE WHEN c.user_a_id = $3 THEN c.user_b_id ELSE c.user_a_id END
             LEFT JOIN chat.messages lm ON lm.id = (
                 SELECT lm2.id FROM chat.messages lm2
                 WHERE lm2.conversation_id = c.id
                   AND lm2.deleted_at IS NULL
                   AND (lm2.scheduled_at IS NULL OR lm2.scheduled_at <= $4 OR lm2.sender_id = $5)
                   AND (lm2.expires_at IS NULL OR lm2.expires_at > $6)
                   AND lm2.created_at > COALESCE(m.hidden_before, $7)
                 ORDER BY lm2.created_at DESC, lm2.id DESC
                 LIMIT 1
             )
             WHERE c.provisional_until IS NULL
             ORDER BY c.updated_at DESC",
            params![user.id, user.id, user.id, now, user.id, now, floor],
        )
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "list_conversations");
            e
        })?;

    let summaries: Vec<ConversationSummary> = rows
        .into_iter()
        .map(|r| {
            let other_user = match (r.other_id, r.other_username) {
                (Some(id), Some(username)) => Some(OtherUserInfo {
                    id,
                    display_name: r.other_name,
                    username,
                    avatar_url: r.other_avatar,
                }),
                _ => None,
            };
            // The newest message the caller may see, so a list can show a
            // preview per row without one request per conversation.
            let last_message = match (r.lm_id, r.lm_sender_id, r.lm_type, r.lm_data, r.lm_created_at) {
                (Some(id), Some(sender_id), Some(message_type), Some(encrypted_data), Some(created_at)) => {
                    Some(LastMessagePreview { id, sender_id, message_type, encrypted_data, created_at })
                }
                _ => None,
            };
            ConversationSummary {
                last_message,
                // `unread_count` only counts other people's messages; the explicit
                // flag carries a hand-marked "unread" in conversations without any.
                is_unread:    r.marked_unread || r.unread_count > 0,
                unread_count: r.unread_count,
                member_count: r.member_count,
                is_pinned:    r.is_pinned,
                is_archived:  r.is_archived,
                is_favorite:  r.is_favorite,
                muted_until:  r.muted_until,
                other_user,
                conversation: r.conv,
            }
        })
        .collect();

    Ok(Json(json!({ "conversations": summaries })))
}

/// True when at least one of `ids` belongs to a guest account. Guests are the
/// core's stand-in for an outside participant, and an instance may keep them out
/// of new conversations. Reading `core.users` is the only way to know: the
/// module is told the *caller's* role by the proxy, never anyone else's.
async fn involves_a_guest(
    db: &DbPool,
    ids: &[Uuid],
) -> ChatResult<bool> {
    if ids.is_empty() {
        return Ok(false);
    }
    // NOTE: cross-schema read of core.users (PostgreSQL/MySQL only). `= ANY($1)`
    // has no portable form, so the id list becomes an `IN (...)`; the existence
    // is a cast `SELECT 1 ... LIMIT 1` whose presence is the answer.
    let one = db.backend().cast("1", SqlType::BigInt);
    let mut qb = DbQueryBuilder::new(
        db.backend(),
        format!("SELECT {one} FROM core.users WHERE role = 'guest' AND id"),
    );
    qb.push_in(ids.iter().copied()).push(" LIMIT 1");
    let found = qb
        .fetch_optional_scalar::<i64>(db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Vérification des comptes invités");
            e
        })?
        .is_some();
    Ok(found)
}

/// POST /conversations — créer une conversation
pub async fn create_conversation(
    State(st): State<AppState>,
    user: ChatUser,
    Json(dto): Json<CreateConversationDto>,
) -> ChatResult<Json<Value>> {
    let conv_type = dto.conv_type.as_deref().unwrap_or("direct");

    match conv_type {
        "direct" => {
            let target = dto
                .target_user
                .ok_or_else(|| ChatError::Validation("target_user requis pour une conv directe".into()))?;

            if target == user.id {
                return Err(ChatError::Validation("Impossible de créer une conv avec soi-même".into()));
            }

            // Instance policy on guest accounts: neither side may be a guest.
            if !st.instance().allow_guest_conversations
                && (user.role == "guest" || involves_a_guest(&st.db, &[target]).await?)
            {
                return Err(ChatError::Forbidden);
            }

            // Vérifier si une conversation directe existe déjà (placeholders never
            // reused: each side of the OR binds the pair again).
            let existing: Option<Conversation> = st
                .db
                .fetch_optional_as(
                    "SELECT * FROM chat.conversations
                     WHERE conv_type = 'direct'
                       AND ((user_a_id = $1 AND user_b_id = $2)
                         OR (user_a_id = $3 AND user_b_id = $4))",
                    params![user.id, target, target, user.id],
                )
                .await?;

            if let Some(c) = existing {
                // Re-add the requesting user in case they previously left.
                let upsert = st.db.backend().upsert(
                    "chat.conversation_members",
                    &["conversation_id", "user_id"],
                    &[Assign::Expr { col: "left_at", expr: "NULL" }],
                );
                st.db
                    .execute(
                        &format!(
                            "INSERT INTO chat.conversation_members (conversation_id, user_id, role)
                             VALUES ($1, $2, 'member'){upsert}"
                        ),
                        params![c.id, user.id],
                    )
                    .await?;
                return Ok(Json(json!({ "conversation": c })));
            }

            let conv_id = new_id();
            let now = chrono::Utc::now();
            st.db
                .execute(
                    "INSERT INTO chat.conversations
                     (id, conv_type, user_a_id, user_b_id, created_by, created_at, updated_at, meeting_settings)
                     VALUES ($1, 'direct', $2, $3, $4, $5, $6, $7)",
                    params![conv_id, user.id, target, user.id, now, now, json!({})],
                )
                .await?;
            let conv: Conversation = st
                .db
                .fetch_one_as("SELECT * FROM chat.conversations WHERE id = $1", params![conv_id])
                .await?;

            let ignore = st.db.backend().on_conflict_do_nothing(&["conversation_id", "user_id"]);
            for uid in [user.id, target] {
                st.db
                    .execute(
                        &format!(
                            "INSERT {}INTO chat.conversation_members (conversation_id, user_id, role)
                             VALUES ($1, $2, 'member'){ignore}",
                            st.db.backend().insert_ignore_prefix()
                        ),
                        params![conv.id, uid],
                    )
                    .await?;
            }

            // Notifier l'interlocuteur via WebSocket pour qu'il rafraîchisse sa liste
            st.ws_hub.send_to(target, WsEnvelope {
                event:   WsEvent::ConversationCreated,
                payload: json!({ "conversation_id": conv.id }),
            }).await;

            Ok(Json(json!({ "conversation": conv })))
        }
        "group" | "channel" => {
            // Instance policy on spaces. Direct conversations are never gated —
            // they are the baseline use of a messenger — but an instance may
            // reserve space creation to its administrators, and may forbid the
            // discoverable ("channel") kind altogether.
            let cfg = st.instance();
            if cfg.space_creation == SpaceCreation::Admins && user.role != "admin" {
                return Err(ChatError::Forbidden);
            }
            if conv_type == "channel" && !cfg.allow_public_spaces {
                return Err(ChatError::Forbidden);
            }
            if !cfg.allow_guest_conversations {
                let members = dto.member_ids.as_deref().unwrap_or(&[]);
                if user.role == "guest" || involves_a_guest(&st.db, members).await? {
                    return Err(ChatError::Forbidden);
                }
            }

            let name = dto
                .name
                .filter(|s| !s.is_empty())
                .ok_or_else(|| ChatError::Validation("name requis pour un groupe".into()))?;

            let is_meeting = dto.is_meeting.unwrap_or(false);
            // A room asked for by a form that is not saved yet. Only a meeting
            // can be provisional: a group or a space is created by the deliberate
            // act of creating it, there is no draft behind it to abandon.
            let provisional = is_meeting && dto.provisional.unwrap_or(false);

            // The provisional deadline (`NOW() + make_interval`) is computed in
            // Rust, and the id/timestamps are bound (no RETURNING on MySQL).
            let conv_id = new_id();
            let now = chrono::Utc::now();
            let provisional_until = provisional
                .then(|| now + chrono::Duration::minutes(PROVISIONAL_GRACE_MIN as i64));
            st.db
                .execute(
                    "INSERT INTO chat.conversations
                     (id, conv_type, name, description, created_by, is_meeting, provisional_until, created_at, updated_at, meeting_settings)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
                    params![conv_id, conv_type, &name, dto.description.as_deref(), user.id, is_meeting, provisional_until, now, now, json!({})],
                )
                .await?;
            let conv: Conversation = st
                .db
                .fetch_one_as("SELECT * FROM chat.conversations WHERE id = $1", params![conv_id])
                .await?;

            // Créateur = owner
            st.db
                .execute(
                    "INSERT INTO chat.conversation_members (conversation_id, user_id, role)
                     VALUES ($1, $2, 'owner')",
                    params![conv.id, user.id],
                )
                .await?;

            // Membres supplémentaires
            if let Some(ids) = &dto.member_ids {
                let ignore = st.db.backend().on_conflict_do_nothing(&["conversation_id", "user_id"]);
                for uid in ids {
                    if *uid == user.id {
                        continue;
                    }
                    st.db
                        .execute(
                            &format!(
                                "INSERT {}INTO chat.conversation_members (conversation_id, user_id, role)
                                 VALUES ($1, $2, 'member'){ignore}",
                                st.db.backend().insert_ignore_prefix()
                            ),
                            params![conv.id, uid],
                        )
                        .await?;
                }
            }

            Ok(Json(json!({ "conversation": conv })))
        }
        _ => Err(ChatError::Validation(format!("Type de conversation invalide: {conv_type}"))),
    }
}

/// POST /conversations/:id/join — rejoindre une SALLE DE RÉUNION par son lien
/// ou un ESPACE public (canal) découvert via /channels/browse. Tout le reste
/// reste sur invitation (403).
/// What the join needs to know about the room: is it a meeting, what kind of
/// conversation, when it was ended (if it was), and who created it.
type JoinableRow = (bool, String, Option<chrono::DateTime<chrono::Utc>>, Option<Uuid>);

pub async fn join_meeting(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    let joinable: Option<JoinableRow> = st
        .db
        .fetch_optional_as(
            "SELECT is_meeting, conv_type, meeting_ended_at, created_by
               FROM chat.conversations WHERE id = $1",
            params![conv_id],
        )
        .await?;

    // A meeting that was ended is closed: nobody walks back in through the
    // link. Its host reopens it, which is what starting it again does.
    if let Some((true, _, Some(_), created_by)) = &joinable {
        let reopens = *created_by == Some(user.id);
        if reopens {
            st.db
                .execute(
                    "UPDATE chat.conversations SET meeting_ended_at = NULL WHERE id = $1",
                    params![conv_id],
                )
                .await?;
        } else {
            return Err(ChatError::MeetingEnded);
        }
    }

    // With discoverable spaces disabled, only a meeting link still lets someone
    // in without an invitation; existing channels stay open to their members.
    // "The host joins first": nobody waits in a lobby, they are simply refused
    // until a host is a member and present. Checked on the SERVER — a rule that
    // only the meeting page enforced would be a suggestion, not a rule.
    if let Some((true, _, _, created_by)) = &joinable {
        let settings: (serde_json::Value,) = st
            .db
            .fetch_one_as("SELECT meeting_settings FROM chat.conversations WHERE id = $1", params![conv_id])
            .await?;
        let s = crate::models::conversation::MeetingSettings::read(&settings.0);
        if s.restricts() && s.host_joins_first && *created_by != Some(user.id) {
            let one = st.db.backend().cast("1", SqlType::BigInt);
            let host_in = st
                .db
                .fetch_optional_scalar::<i64>(
                    &format!(
                        "SELECT {one} FROM chat.conversation_members m
                          WHERE m.conversation_id = $1 AND m.left_at IS NULL
                            AND m.role IN ('owner', 'admin') LIMIT 1"
                    ),
                    params![conv_id],
                )
                .await?
                .is_some();
            if !host_in {
                return Err(ChatError::Forbidden);
            }
        }
    }

    // Who the link lets in. `open` is what a link has always meant here;
    // `trusted` means the host put you in the room, or let you in after you
    // asked. Checked on the SERVER — an access rule the page enforced would be
    // a suggestion.
    if let Some((true, _, _, created_by)) = &joinable {
        let row: (serde_json::Value,) = st
            .db
            .fetch_one_as("SELECT meeting_settings FROM chat.conversations WHERE id = $1", params![conv_id])
            .await?;
        let s = crate::models::conversation::MeetingSettings::read(&row.0);
        if s.trusted_only() && *created_by != Some(user.id) {
            // Two existence probes rather than one `SELECT EXISTS(..), EXISTS(..)`
            // row (EXISTS decodes as bool only on PostgreSQL).
            let one = st.db.backend().cast("1", SqlType::BigInt);
            let is_member = st
                .db
                .fetch_optional_scalar::<i64>(
                    &format!(
                        "SELECT {one} FROM chat.conversation_members m
                          WHERE m.conversation_id = $1 AND m.user_id = $2 AND m.left_at IS NULL LIMIT 1"
                    ),
                    params![conv_id, user.id],
                )
                .await?
                .is_some();
            let admitted = st
                .db
                .fetch_optional_scalar::<i64>(
                    &format!(
                        "SELECT {one} FROM chat.meeting_knocks k
                          WHERE k.conversation_id = $1 AND k.user_id = $2 AND k.status = 'admitted' LIMIT 1"
                    ),
                    params![conv_id, user.id],
                )
                .await?
                .is_some();
            if !is_member && !admitted {
                return Err(if s.allow_knocking { ChatError::KnockRequired } else { ChatError::Forbidden });
            }
        }
    }

    let public_spaces = st.instance().allow_public_spaces;

    match joinable.map(|(meeting, ty, _, _)| meeting || (ty == "channel" && public_spaces)) {
        Some(true) => {
            let upsert = st.db.backend().upsert(
                "chat.conversation_members",
                &["conversation_id", "user_id"],
                &[Assign::Expr { col: "left_at", expr: "NULL" }],
            );
            st.db
                .execute(
                    &format!(
                        "INSERT INTO chat.conversation_members (conversation_id, user_id, role)
                         VALUES ($1, $2, 'member'){upsert}"
                    ),
                    params![conv_id, user.id],
                )
                .await?;
            Ok(Json(json!({ "ok": true, "conversation_id": conv_id })))
        }
        Some(false) => Err(ChatError::Forbidden),
        None => Err(ChatError::NotFound(conv_id.to_string())),
    }
}

/// GET /channels/browse?q= — public spaces (channels) the user has not joined,
/// with their member count. Powers the "browse spaces" page.
pub async fn browse_channels(
    State(st): State<AppState>,
    user: ChatUser,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> ChatResult<Json<Value>> {
    let q = params.get("q").map(|s| s.trim().to_lowercase()).unwrap_or_default();
    let joined = params.get("joined").map(|s| s == "true").unwrap_or(false);

    // Discoverable spaces disabled: nothing is advertised to a non-member. The
    // "joined" listing stays, so a member never loses sight of their own spaces.
    if !joined && !st.instance().allow_public_spaces {
        return Ok(Json(json!({ "channels": [] })));
    }

    // is_member is a cast `SELECT 1 ... LIMIT 1` scalar subquery (NULL when the
    // caller is not a member) rather than `EXISTS(..)`, which decodes as bool only
    // on PostgreSQL. The name filter binds a `%q%` pattern built in Rust (q is
    // already lowercased) instead of the PostgreSQL-only `||` concatenation.
    type ChannelRow = (Uuid, Option<String>, Option<String>, chrono::DateTime<chrono::Utc>, i64, Option<i64>);
    let one = st.db.backend().cast("1", SqlType::BigInt);
    let pattern = format!("%{q}%");
    let rows: Vec<ChannelRow> = st
        .db
        .fetch_all_as(
            &format!(
                "SELECT c.id, c.name, c.description, c.created_at,
                        (SELECT COUNT(*) FROM chat.conversation_members m2
                          WHERE m2.conversation_id = c.id AND m2.left_at IS NULL) AS member_count,
                        (SELECT {one} FROM chat.conversation_members me
                          WHERE me.conversation_id = c.id AND me.user_id = $1 AND me.left_at IS NULL LIMIT 1) AS is_member
                 FROM chat.conversations c
                 WHERE c.conv_type = 'channel' AND c.is_meeting = FALSE
                   AND LOWER(COALESCE(c.name, '')) LIKE $2
                 ORDER BY member_count DESC, c.created_at DESC
                 LIMIT 50"
            ),
            params![user.id, pattern],
        )
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "browse_channels");
            e
        })?;

    let channels: Vec<Value> = rows
        .into_iter()
        .map(|(id, name, description, created_at, member_count, membership)| {
            (id, name, description, created_at, member_count, membership.is_some())
        })
        .filter(|(_, _, _, _, _, is_member)| *is_member == joined)
        .map(|(id, name, description, created_at, member_count, is_member)| {
            json!({
                "id": id,
                "name": name,
                "description": description,
                "created_at": created_at,
                "member_count": member_count,
                "is_member": is_member,
            })
        })
        .collect();

    Ok(Json(json!({ "channels": channels })))
}

/// GET /conversations/:id — détails
pub async fn get_conversation(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    message_service::assert_member(&st.db, conv_id, user.id).await?;

    let conv: Conversation = st
        .db
        .fetch_optional_as("SELECT * FROM chat.conversations WHERE id = $1", params![conv_id])
        .await?
        .ok_or_else(|| ChatError::NotFound(conv_id.to_string()))?;

    #[derive(serde::Serialize, sqlx::FromRow)]
    struct MemberRow {
        user_id:      Uuid,
        role:         String,
        joined_at:    chrono::DateTime<chrono::Utc>,
        display_name: Option<String>,
        username:     String,
        avatar_url:   Option<String>,
    }

    // NOTE: cross-schema join to core.users (PostgreSQL/MySQL only).
    let members: Vec<MemberRow> = st
        .db
        .fetch_all_as(
            "SELECT m.user_id, m.role, m.joined_at,
                    u.display_name, u.username, u.avatar_url
             FROM chat.conversation_members m
             JOIN core.users u ON u.id = m.user_id
             WHERE m.conversation_id = $1 AND m.left_at IS NULL",
            params![conv_id],
        )
        .await?;

    Ok(Json(json!({ "conversation": conv, "members": members })))
}

/// PATCH /conversations/:id — modifier nom/avatar
pub async fn update_conversation(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
    Json(dto): Json<UpdateConversationDto>,
) -> ChatResult<Json<Value>> {
    // Vérifier admin/owner
    let role: Option<String> = st
        .db
        .fetch_optional_scalar(
            "SELECT role FROM chat.conversation_members
             WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL",
            params![conv_id, user.id],
        )
        .await?;

    match role.as_deref() {
        Some("admin") | Some("owner") => {}
        _ => return Err(ChatError::Forbidden),
    }

    // The name BEFORE, so the announcement below can be made only when the name
    // actually moved. Renaming a room to what it is already called must produce
    // no event: the module on the other side would rename its own object back,
    // and the two would keep answering each other.
    let before: Option<String> = st
        .db
        .fetch_optional_scalar::<Option<String>>(
            "SELECT name FROM chat.conversations WHERE id = $1",
            params![conv_id],
        )
        .await?
        .flatten();

    st.db
        .execute(
            "UPDATE chat.conversations
             SET name        = COALESCE($1, name),
                 description = COALESCE($2, description),
                 updated_at  = $3
             WHERE id = $4",
            params![dto.name.as_deref(), dto.description.as_deref(), chrono::Utc::now(), conv_id],
        )
        .await?;
    let conv: Conversation = st
        .db
        .fetch_one_as("SELECT * FROM chat.conversations WHERE id = $1", params![conv_id])
        .await?;

    // A meeting that belongs to something else carries ITS title. Renamed here,
    // the thing it belongs to has to follow — otherwise the event says one name
    // and the meetings list another, an inch apart.
    if conv.is_meeting && conv.name != before {
        if let (Some(owner), Some(name)) = (conv.linked_ref.as_deref(), conv.name.as_deref()) {
            crate::events::publisher::emit_meeting_renamed(&st, owner, name).await;
        }
    }

    Ok(Json(json!({ "conversation": conv })))
}

/// DELETE /conversations/:id — quitter la conversation
pub async fn leave_conversation(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    message_service::assert_member(&st.db, conv_id, user.id).await?;

    // hidden_before marque le point à partir duquel l'utilisateur verra les messages
    // s'il est rajouté à la conversation plus tard (ex: nouveau message dans un DM)
    let now = chrono::Utc::now();
    st.db
        .execute(
            "UPDATE chat.conversation_members
             SET left_at = $1, hidden_before = $2
             WHERE conversation_id = $3 AND user_id = $4",
            params![now, now, conv_id, user.id],
        )
        .await?;

    Ok(Json(json!({ "ok": true })))
}

/// POST /conversations/:id/members — ajouter des membres (groupe)
pub async fn add_members(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
    Json(dto): Json<AddMembersDto>,
) -> ChatResult<Json<Value>> {
    message_service::assert_member(&st.db, conv_id, user.id).await?;

    let cfg = st.instance();

    // Instance policy on guest accounts: they may not be brought into a space.
    if !cfg.allow_guest_conversations && involves_a_guest(&st.db, &dto.user_ids).await? {
        return Err(ChatError::Forbidden);
    }

    // Instance policy: adding members may be reserved to the space's owner and
    // admins. Direct conversations have no such notion and keep their behaviour.
    if cfg.space_invite_policy == SpaceInvitePolicy::Managers {
        // Read the raw conv_type and compare in Rust: `SELECT conv_type = 'direct'`
        // is a boolean expression that decodes as bool only on PostgreSQL.
        let conv_type: Option<String> = st
            .db
            .fetch_optional_scalar(
                "SELECT conv_type FROM chat.conversations WHERE id = $1",
                params![conv_id],
            )
            .await
            .map_err(|e| {
                tracing::error!(error = %e, "add_members: lecture du type de conversation");
                e
            })?;
        let is_direct = conv_type.as_deref() == Some("direct");

        if !is_direct {
            let role: Option<String> = st
                .db
                .fetch_optional_scalar(
                    "SELECT role FROM chat.conversation_members
                     WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL",
                    params![conv_id, user.id],
                )
                .await
                .map_err(|e| {
                    tracing::error!(error = %e, "add_members: lecture du rôle");
                    e
                })?;

            if !matches!(role.as_deref(), Some("admin") | Some("owner")) {
                return Err(ChatError::Forbidden);
            }
        }
    }

    let upsert = st.db.backend().upsert(
        "chat.conversation_members",
        &["conversation_id", "user_id"],
        &[Assign::Expr { col: "left_at", expr: "NULL" }],
    );
    for uid in &dto.user_ids {
        st.db
            .execute(
                &format!(
                    "INSERT INTO chat.conversation_members (conversation_id, user_id, role)
                     VALUES ($1, $2, 'member'){upsert}"
                ),
                params![conv_id, uid],
            )
            .await?;
    }

    Ok(Json(json!({ "ok": true, "added": dto.user_ids.len() })))
}

/// DELETE /conversations/:id/members/:uid — retirer un membre
pub async fn remove_member(
    State(st): State<AppState>,
    user: ChatUser,
    Path((conv_id, target_uid)): Path<(Uuid, Uuid)>,
) -> ChatResult<Json<Value>> {
    // Owner/admin ou l'utilisateur lui-même
    let role: Option<String> = st
        .db
        .fetch_optional_scalar(
            "SELECT role FROM chat.conversation_members
             WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL",
            params![conv_id, user.id],
        )
        .await?;

    let can_remove = matches!(role.as_deref(), Some("admin") | Some("owner"))
        || target_uid == user.id;

    if !can_remove {
        return Err(ChatError::Forbidden);
    }

    st.db
        .execute(
            "UPDATE chat.conversation_members SET left_at = $1
             WHERE conversation_id = $2 AND user_id = $3",
            params![chrono::Utc::now(), conv_id, target_uid],
        )
        .await?;

    Ok(Json(json!({ "ok": true })))
}

/// PATCH /conversations/:id/member-settings — pin, archive, favorite, mute, mark-unread
pub async fn update_member_settings(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
    Json(dto): Json<MemberSettingsDto>,
) -> ChatResult<Json<Value>> {
    message_service::assert_member(&st.db, conv_id, user.id).await?;

    if let Some(pin) = dto.pin {
        st.db.execute("UPDATE chat.conversation_members SET is_pinned = $1 WHERE conversation_id = $2 AND user_id = $3", params![pin, conv_id, user.id]).await?;
    }
    if let Some(archive) = dto.archive {
        st.db.execute("UPDATE chat.conversation_members SET is_archived = $1 WHERE conversation_id = $2 AND user_id = $3", params![archive, conv_id, user.id]).await?;
    }
    if let Some(fav) = dto.favorite {
        st.db.execute("UPDATE chat.conversation_members SET is_favorite = $1 WHERE conversation_id = $2 AND user_id = $3", params![fav, conv_id, user.id]).await?;
    }
    if let Some(until) = dto.mute_until {
        st.db.execute("UPDATE chat.conversation_members SET muted_until = $1 WHERE conversation_id = $2 AND user_id = $3", params![until, conv_id, user.id]).await?;
    }
    if dto.unmute == Some(true) {
        st.db.execute("UPDATE chat.conversation_members SET muted_until = NULL WHERE conversation_id = $1 AND user_id = $2", params![conv_id, user.id]).await?;
    }
    match dto.mark_unread {
        Some(true) => {
            st.db.execute("UPDATE chat.conversation_members SET last_read_at = $1, last_read_message_id = NULL, marked_unread = TRUE WHERE conversation_id = $2 AND user_id = $3", params![epoch_floor(), conv_id, user.id]).await?;
        }
        // Clearing the flag: opening a conversation with no message at all can't go
        // through mark_read (it needs a message id), so it lands here.
        Some(false) => {
            st.db.execute("UPDATE chat.conversation_members SET last_read_at = $1, marked_unread = FALSE WHERE conversation_id = $2 AND user_id = $3", params![chrono::Utc::now(), conv_id, user.id]).await?;
        }
        None => {}
    }

    Ok(Json(json!({ "ok": true })))
}

/// DELETE /conversations/:id/messages — effacer tous les messages (soft-delete)
pub async fn clear_messages(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    message_service::assert_member(&st.db, conv_id, user.id).await?;

    st.db
        .execute(
            "UPDATE chat.messages SET deleted_at = $1 WHERE conversation_id = $2 AND deleted_at IS NULL",
            params![chrono::Utc::now(), conv_id],
        )
        .await?;

    Ok(Json(json!({ "ok": true })))
}

/// `PATCH /conversations/:id/meeting-settings` — what the host decided about
/// this room, ahead of the meeting.
///
/// Reserved to the host, and checked here rather than hidden in the panel: a
/// moderation setting a guest could POST would moderate nothing. The body is
/// the whole set, because that is how the panel edits it — one Save, one state.
pub async fn update_meeting_settings(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
    Json(dto): Json<crate::models::conversation::MeetingSettings>,
) -> ChatResult<Json<Value>> {
    let row: Option<(bool, Option<String>)> = st
        .db
        .fetch_optional_as(
            "SELECT c.is_meeting, m.role
               FROM chat.conversations c
               LEFT JOIN chat.conversation_members m
                 ON m.conversation_id = c.id AND m.user_id = $2 AND m.left_at IS NULL
              WHERE c.id = $1",
            params![conv_id, user.id],
        )
        .await?;

    let (is_meeting, role) = row.ok_or(ChatError::NotFound(conv_id.to_string()))?;
    if !is_meeting {
        return Err(ChatError::Validation("Cette conversation n'est pas une réunion".into()));
    }
    if !matches!(role.as_deref(), Some("owner") | Some("admin")) {
        return Err(ChatError::Forbidden);
    }

    let value = serde_json::to_value(&dto).unwrap_or_else(|_| json!({}));
    st.db
        .execute(
            "UPDATE chat.conversations SET meeting_settings = $1 WHERE id = $2",
            params![value.clone(), conv_id],
        )
        .await?;

    Ok(Json(json!({ "meeting_settings": value })))
}

/// How long a room may stay provisional without a word from the form that made
/// it. Long enough to write an event without hurrying, short enough that an
/// abandoned draft does not sit in the database for a day.
pub const PROVISIONAL_GRACE_MIN: i32 = 120;

/// Has this room been used by anyone? A provisional room that somebody has
/// already joined or written in is no longer a draft: the link was shared and
/// answered, whatever became of the form. Nothing deletes one of those — not
/// the ✕, not the sweep.
pub const UNUSED_ROOM: &str = "NOT EXISTS (SELECT 1 FROM chat.messages msg WHERE msg.conversation_id = conversations.id)
     AND (SELECT COUNT(*) FROM chat.conversation_members cm
           WHERE cm.conversation_id = conversations.id AND cm.left_at IS NULL) <= 1";

/// `POST /conversations/:id/provisional/keep` — the form is still open.
///
/// The deadline only exists to catch a browser that went away without saying
/// anything, so a browser that is plainly still there pushes it back. Someone
/// composing an event all afternoon must not watch its room disappear.
pub async fn keep_provisional(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    assert_meeting_host(&st.db, conv_id, user.id).await?;
    // The new deadline is computed in Rust (no make_interval); the guarded update
    // succeeds only while the room is still provisional, and its row count stands
    // in for the old RETURNING.
    let new_deadline = chrono::Utc::now() + chrono::Duration::minutes(PROVISIONAL_GRACE_MIN as i64);
    let updated = st
        .db
        .execute(
            "UPDATE chat.conversations SET provisional_until = $1
              WHERE id = $2 AND provisional_until IS NOT NULL",
            params![new_deadline, conv_id],
        )
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "keep_provisional");
            e
        })?;
    // A room that is no longer provisional is not an error: it was confirmed
    // while this call was in flight, which is the outcome we wanted anyway.
    let kept = (updated > 0).then_some(new_deadline);
    Ok(Json(json!({ "provisional_until": kept })))
}

/// `POST /conversations/:id/provisional/confirm` — the form was saved.
///
/// The room stops being a draft and becomes an ordinary room. Idempotent: a
/// room that was never provisional is already in the state being asked for.
pub async fn confirm_provisional(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    assert_meeting_host(&st.db, conv_id, user.id).await?;
    st.db
        .execute(
            "UPDATE chat.conversations SET provisional_until = NULL WHERE id = $1",
            params![conv_id],
        )
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "confirm_provisional");
            e
        })?;
    Ok(Json(json!({ "ok": true })))
}

/// `DELETE /conversations/:id/provisional` — the form said no.
///
/// The call was taken off the event, or the event was closed without being
/// saved. The room went with it, so it goes too — really deleted, not left
/// behind emptied, because it was never anybody's.
///
/// Only ever a PROVISIONAL and UNUSED room: a confirmed room is somebody's, and
/// so is one that people have already joined. Both conditions are checked here
/// rather than trusted from the caller — the browser knows what it created, the
/// server knows what became of it.
pub async fn drop_provisional(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    assert_meeting_host(&st.db, conv_id, user.id).await?;
    // Audited: the only interpolation is UNUSED_ROOM, a const of this module (no
    // alias — MySQL/SQLite reject an aliased DELETE target; the correlated
    // subqueries reference the table by name).
    let deleted = st
        .db
        .execute(
            &format!(
                "DELETE FROM chat.conversations
                  WHERE id = $1 AND provisional_until IS NOT NULL AND {UNUSED_ROOM}"
            ),
            params![conv_id],
        )
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "drop_provisional");
            e
        })?;

    Ok(Json(json!({ "deleted": deleted > 0 })))
}

/// Is this person a host of that meeting? The single place that answers it,
/// so no handler invents its own idea of who may decide.
async fn assert_meeting_host(db: &DbPool, conv_id: Uuid, user_id: Uuid) -> ChatResult<()> {
    let row: Option<(bool, Option<String>, Option<Uuid>)> = db
        .fetch_optional_as(
            "SELECT c.is_meeting, m.role, c.created_by
               FROM chat.conversations c
               LEFT JOIN chat.conversation_members m
                 ON m.conversation_id = c.id AND m.user_id = $2 AND m.left_at IS NULL
              WHERE c.id = $1",
            params![conv_id, user_id],
        )
        .await?;
    let (is_meeting, role, created_by) = row.ok_or(ChatError::NotFound(conv_id.to_string()))?;
    if !is_meeting {
        return Err(ChatError::Validation("Cette conversation n'est pas une réunion".into()));
    }
    if created_by == Some(user_id) || matches!(role.as_deref(), Some("owner") | Some("admin")) {
        Ok(())
    } else {
        Err(ChatError::Forbidden)
    }
}

/// After this many refusals, asking is over — the host must add the person.
const MAX_KNOCK_REFUSALS: i32 = 2;

/// `POST /conversations/:id/knock` — "let me in".
///
/// Idempotent by design: asking twice is asking once, so the host is never
/// shown the same person twice. A previous refusal is cleared, because asking
/// again is a new request and the host may well have changed their mind.
pub async fn knock(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    let row: Option<(bool, serde_json::Value)> = st
        .db
        .fetch_optional_as(
            "SELECT is_meeting, meeting_settings FROM chat.conversations WHERE id = $1",
            params![conv_id],
        )
        .await?;
    let (is_meeting, settings) = row.ok_or(ChatError::NotFound(conv_id.to_string()))?;
    let s = crate::models::conversation::MeetingSettings::read(&settings);
    if !is_meeting || !s.trusted_only() || !s.allow_knocking {
        return Err(ChatError::Forbidden);
    }

    // Refused twice is refused. A door that can be knocked on forever is a way
    // of knocking until someone gives in; past that, only a deliberate act by
    // the host — adding the person to the room — opens it.
    let refused: Option<(i32,)> = st
        .db
        .fetch_optional_as(
            "SELECT denied_count FROM chat.meeting_knocks WHERE conversation_id = $1 AND user_id = $2",
            params![conv_id, user.id],
        )
        .await?;
    if refused.map(|r| r.0).unwrap_or(0) >= MAX_KNOCK_REFUSALS {
        return Err(ChatError::Forbidden);
    }

    // Upsert with an expression that reads the row's current status (the dialect
    // helper spells `{cur}` per engine), then re-select the result (no RETURNING
    // on MySQL).
    let upsert = st.db.backend().upsert(
        "chat.meeting_knocks",
        &["conversation_id", "user_id"],
        &[
            Assign::Expr {
                col: "status",
                expr: "CASE WHEN {cur} = 'admitted' THEN 'admitted' ELSE 'pending' END",
            },
            Assign::Incoming("requested_at"),
            Assign::Expr { col: "decided_at", expr: "NULL" },
        ],
    );
    st.db
        .execute(
            &format!(
                "INSERT INTO chat.meeting_knocks (conversation_id, user_id, status, requested_at)
                 VALUES ($1, $2, 'pending', $3){upsert}"
            ),
            params![conv_id, user.id, chrono::Utc::now()],
        )
        .await?;
    let status: String = st
        .db
        .fetch_scalar(
            "SELECT status FROM chat.meeting_knocks WHERE conversation_id = $1 AND user_id = $2",
            params![conv_id, user.id],
        )
        .await?;

    Ok(Json(json!({ "status": status })))
}

/// `GET /conversations/:id/knocks` — who is waiting. Host only.
///
/// Also answers the ASKER about themselves, which is how a waiting page learns
/// it was let in without a socket: `?me=true` returns just their own status.
pub async fn list_knocks(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> ChatResult<Json<Value>> {
    if params.get("me").map(|v| v == "true").unwrap_or(false) {
        let mine: Option<(String, i32)> = st
            .db
            .fetch_optional_as(
                "SELECT status, denied_count FROM chat.meeting_knocks
                  WHERE conversation_id = $1 AND user_id = $2",
                params![conv_id, user.id],
            )
            .await?;
        let exhausted = mine.as_ref().map(|r| r.1 >= MAX_KNOCK_REFUSALS).unwrap_or(false);
        return Ok(Json(json!({
            "status": mine.map(|r| r.0),
            "exhausted": exhausted,
        })));
    }

    assert_meeting_host(&st.db, conv_id, user.id).await?;
    let rows: Vec<(Uuid, chrono::DateTime<chrono::Utc>)> = st
        .db
        .fetch_all_as(
            "SELECT user_id, requested_at FROM chat.meeting_knocks
              WHERE conversation_id = $1 AND status = 'pending'
              ORDER BY requested_at",
            params![conv_id],
        )
        .await?;

    let knocks: Vec<Value> = rows
        .into_iter()
        .map(|(user_id, requested_at)| json!({ "user_id": user_id, "requested_at": requested_at }))
        .collect();
    Ok(Json(json!({ "knocks": knocks })))
}

#[derive(serde::Deserialize)]
pub struct KnockDecision {
    pub admit: bool,
}

/// `POST /conversations/:id/knocks/:uid` — the host decides.
///
/// Admitting puts the person in the room here and now: the answer to "let me
/// in" is being in, not a promise the next request will honour.
pub async fn decide_knock(
    State(st): State<AppState>,
    user: ChatUser,
    Path((conv_id, target)): Path<(Uuid, Uuid)>,
    Json(dto): Json<KnockDecision>,
) -> ChatResult<Json<Value>> {
    assert_meeting_host(&st.db, conv_id, user.id).await?;

    let member_upsert = st.db.backend().upsert(
        "chat.conversation_members",
        &["conversation_id", "user_id"],
        &[Assign::Expr { col: "left_at", expr: "NULL" }],
    );
    let mut tx = st.db.begin().await?;
    let updated = tx
        .execute(
            "UPDATE chat.meeting_knocks SET status = $3, decided_at = $4
              WHERE conversation_id = $1 AND user_id = $2 AND status = 'pending'",
            params![conv_id, target, if dto.admit { "admitted" } else { "denied" }, chrono::Utc::now()],
        )
        .await?;

    if !dto.admit {
        tx.execute(
            "UPDATE chat.meeting_knocks SET denied_count = denied_count + 1
              WHERE conversation_id = $1 AND user_id = $2",
            params![conv_id, target],
        )
        .await?;
    }

    if updated == 0 {
        tx.rollback().await?;
        return Err(ChatError::NotFound(target.to_string()));
    }

    if dto.admit {
        tx.execute(
            &format!(
                "INSERT INTO chat.conversation_members (conversation_id, user_id, role)
                 VALUES ($1, $2, 'member'){member_upsert}"
            ),
            params![conv_id, target],
        )
        .await?;
    }

    tx.commit().await?;
    Ok(Json(json!({ "ok": true, "admitted": dto.admit })))
}
