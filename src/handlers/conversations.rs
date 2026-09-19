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
use serde_json::{json, Value};
use uuid::Uuid;

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

    let rows = sqlx::query_as::<_, SummaryRow>(
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
           ON m.conversation_id = c.id AND m.user_id = $1 AND m.left_at IS NULL
         LEFT JOIN core.users u
           ON c.conv_type = 'direct'
          AND u.id = CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END
         LEFT JOIN LATERAL (
             SELECT lm.id, lm.sender_id, lm.message_type, lm.encrypted_data, lm.created_at
             FROM chat.messages lm
             WHERE lm.conversation_id = c.id
               AND lm.deleted_at IS NULL
               AND (lm.scheduled_at IS NULL OR lm.scheduled_at <= NOW() OR lm.sender_id = $1)
               AND (lm.expires_at IS NULL OR lm.expires_at > NOW())
               AND lm.created_at > COALESCE(m.hidden_before, '-infinity'::timestamptz)
             ORDER BY lm.created_at DESC, lm.id DESC
             LIMIT 1
         ) lm ON TRUE
         WHERE c.provisional_until IS NULL
         ORDER BY c.updated_at DESC",
    )
    .bind(user.id)
    .fetch_all(&st.db)
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
    db: &sqlx::PgPool,
    ids: &[Uuid],
) -> ChatResult<bool> {
    let found: Option<bool> = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM core.users WHERE id = ANY($1) AND role = 'guest')",
    )
    .bind(ids)
    .fetch_optional(db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "Vérification des comptes invités");
        e
    })?;
    Ok(found.unwrap_or(false))
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

            // Vérifier si une conversation directe existe déjà
            let existing: Option<Conversation> = sqlx::query_as(
                "SELECT * FROM chat.conversations
                 WHERE conv_type = 'direct'
                   AND ((user_a_id = $1 AND user_b_id = $2)
                     OR (user_a_id = $2 AND user_b_id = $1))",
            )
            .bind(user.id)
            .bind(target)
            .fetch_optional(&st.db)
            .await?;

            if let Some(c) = existing {
                // Re-add the requesting user in case they previously left
                sqlx::query(
                    "INSERT INTO chat.conversation_members (conversation_id, user_id, role)
                     VALUES ($1, $2, 'member')
                     ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL",
                )
                .bind(c.id)
                .bind(user.id)
                .execute(&st.db)
                .await?;
                return Ok(Json(json!({ "conversation": c })));
            }

            let conv: Conversation = sqlx::query_as(
                "INSERT INTO chat.conversations (conv_type, user_a_id, user_b_id, created_by)
                 VALUES ('direct', $1, $2, $1)
                 RETURNING *",
            )
            .bind(user.id)
            .bind(target)
            .fetch_one(&st.db)
            .await?;

            for uid in [user.id, target] {
                sqlx::query(
                    "INSERT INTO chat.conversation_members (conversation_id, user_id, role)
                     VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
                )
                .bind(conv.id)
                .bind(uid)
                .execute(&st.db)
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

            let conv: Conversation = sqlx::query_as(
                "INSERT INTO chat.conversations (conv_type, name, description, created_by, is_meeting, provisional_until)
                 VALUES ($1, $2, $3, $4, $5,
                         CASE WHEN $6 THEN NOW() + make_interval(mins => $7) ELSE NULL END)
                 RETURNING *",
            )
            .bind(conv_type)
            .bind(&name)
            .bind(&dto.description)
            .bind(user.id)
            .bind(is_meeting)
            .bind(provisional)
            .bind(PROVISIONAL_GRACE_MIN)
            .fetch_one(&st.db)
            .await?;

            // Créateur = owner
            sqlx::query(
                "INSERT INTO chat.conversation_members (conversation_id, user_id, role)
                 VALUES ($1, $2, 'owner')",
            )
            .bind(conv.id)
            .bind(user.id)
            .execute(&st.db)
            .await?;

            // Membres supplémentaires
            if let Some(ids) = &dto.member_ids {
                for uid in ids {
                    if *uid == user.id {
                        continue;
                    }
                    sqlx::query(
                        "INSERT INTO chat.conversation_members (conversation_id, user_id, role)
                         VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
                    )
                    .bind(conv.id)
                    .bind(uid)
                    .execute(&st.db)
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
    let joinable: Option<JoinableRow> =
        sqlx::query_as(
            "SELECT is_meeting, conv_type, meeting_ended_at, created_by
               FROM chat.conversations WHERE id = $1",
        )
            .bind(conv_id)
            .fetch_optional(&st.db)
            .await?;

    // A meeting that was ended is closed: nobody walks back in through the
    // link. Its host reopens it, which is what starting it again does.
    if let Some((true, _, Some(_), created_by)) = &joinable {
        let reopens = *created_by == Some(user.id);
        if reopens {
            sqlx::query("UPDATE chat.conversations SET meeting_ended_at = NULL WHERE id = $1")
                .bind(conv_id)
                .execute(&st.db)
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
        let settings: (serde_json::Value,) =
            sqlx::query_as("SELECT meeting_settings FROM chat.conversations WHERE id = $1")
                .bind(conv_id)
                .fetch_one(&st.db)
                .await?;
        let s = crate::models::conversation::MeetingSettings::read(&settings.0);
        if s.restricts() && s.host_joins_first && *created_by != Some(user.id) {
            let host_in: Option<(bool,)> = sqlx::query_as(
                "SELECT EXISTS(SELECT 1 FROM chat.conversation_members m
                                WHERE m.conversation_id = $1 AND m.left_at IS NULL
                                  AND m.role IN ('owner', 'admin'))",
            )
            .bind(conv_id)
            .fetch_optional(&st.db)
            .await?;
            if !host_in.map(|r| r.0).unwrap_or(false) {
                return Err(ChatError::Forbidden);
            }
        }
    }

    // Who the link lets in. `open` is what a link has always meant here;
    // `trusted` means the host put you in the room, or let you in after you
    // asked. Checked on the SERVER — an access rule the page enforced would be
    // a suggestion.
    if let Some((true, _, _, created_by)) = &joinable {
        let row: (serde_json::Value,) =
            sqlx::query_as("SELECT meeting_settings FROM chat.conversations WHERE id = $1")
                .bind(conv_id)
                .fetch_one(&st.db)
                .await?;
        let s = crate::models::conversation::MeetingSettings::read(&row.0);
        if s.trusted_only() && *created_by != Some(user.id) {
            let known: Option<(bool, bool)> = sqlx::query_as(
                "SELECT
                   EXISTS(SELECT 1 FROM chat.conversation_members m
                           WHERE m.conversation_id = $1 AND m.user_id = $2 AND m.left_at IS NULL),
                   EXISTS(SELECT 1 FROM chat.meeting_knocks k
                           WHERE k.conversation_id = $1 AND k.user_id = $2 AND k.status = 'admitted')",
            )
            .bind(conv_id)
            .bind(user.id)
            .fetch_optional(&st.db)
            .await?;
            let (is_member, admitted) = known.unwrap_or((false, false));
            if !is_member && !admitted {
                return Err(if s.allow_knocking { ChatError::KnockRequired } else { ChatError::Forbidden });
            }
        }
    }

    let public_spaces = st.instance().allow_public_spaces;

    match joinable.map(|(meeting, ty, _, _)| meeting || (ty == "channel" && public_spaces)) {
        Some(true) => {
            sqlx::query(
                "INSERT INTO chat.conversation_members (conversation_id, user_id, role)
                 VALUES ($1, $2, 'member')
                 ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL",
            )
            .bind(conv_id)
            .bind(user.id)
            .execute(&st.db)
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

    type ChannelRow = (Uuid, Option<String>, Option<String>, chrono::DateTime<chrono::Utc>, i64, bool);
    let rows: Vec<ChannelRow> = sqlx::query_as(
        "SELECT c.id, c.name, c.description, c.created_at,
                (SELECT COUNT(*) FROM chat.conversation_members m2
                  WHERE m2.conversation_id = c.id AND m2.left_at IS NULL) AS member_count,
                EXISTS(SELECT 1 FROM chat.conversation_members me
                        WHERE me.conversation_id = c.id AND me.user_id = $1 AND me.left_at IS NULL) AS is_member
         FROM chat.conversations c
         WHERE c.conv_type = 'channel' AND c.is_meeting = FALSE
           AND ($2 = '' OR LOWER(COALESCE(c.name, '')) LIKE '%' || $2 || '%')
         ORDER BY member_count DESC, c.created_at DESC
         LIMIT 50",
    )
    .bind(user.id)
    .bind(&q)
    .fetch_all(&st.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "browse_channels");
        e
    })?;

    let channels: Vec<Value> = rows
        .into_iter()
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

    let conv: Conversation = sqlx::query_as("SELECT * FROM chat.conversations WHERE id = $1")
        .bind(conv_id)
        .fetch_optional(&st.db)
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

    let members: Vec<MemberRow> = sqlx::query_as(
        "SELECT m.user_id, m.role, m.joined_at,
                u.display_name, u.username, u.avatar_url
         FROM chat.conversation_members m
         JOIN core.users u ON u.id = m.user_id
         WHERE m.conversation_id = $1 AND m.left_at IS NULL",
    )
    .bind(conv_id)
    .fetch_all(&st.db)
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
    let role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM chat.conversation_members
         WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL",
    )
    .bind(conv_id)
    .bind(user.id)
    .fetch_optional(&st.db)
    .await?;

    match role.as_deref() {
        Some("admin") | Some("owner") => {}
        _ => return Err(ChatError::Forbidden),
    }

    // The name BEFORE, so the announcement below can be made only when the name
    // actually moved. Renaming a room to what it is already called must produce
    // no event: the module on the other side would rename its own object back,
    // and the two would keep answering each other.
    let before: Option<String> = sqlx::query_scalar("SELECT name FROM chat.conversations WHERE id = $1")
        .bind(conv_id)
        .fetch_optional(&st.db)
        .await?
        .flatten();

    let conv: Conversation = sqlx::query_as(
        "UPDATE chat.conversations
         SET name        = COALESCE($2, name),
             description = COALESCE($3, description),
             updated_at  = NOW()
         WHERE id = $1
         RETURNING *",
    )
    .bind(conv_id)
    .bind(&dto.name)
    .bind(&dto.description)
    .fetch_one(&st.db)
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
    sqlx::query(
        "UPDATE chat.conversation_members
         SET left_at = NOW(), hidden_before = NOW()
         WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(conv_id)
    .bind(user.id)
    .execute(&st.db)
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
        let is_direct: bool = sqlx::query_scalar(
            "SELECT conv_type = 'direct' FROM chat.conversations WHERE id = $1",
        )
        .bind(conv_id)
        .fetch_optional(&st.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "add_members: lecture du type de conversation");
            e
        })?
        .unwrap_or(false);

        if !is_direct {
            let role: Option<String> = sqlx::query_scalar(
                "SELECT role FROM chat.conversation_members
                 WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL",
            )
            .bind(conv_id)
            .bind(user.id)
            .fetch_optional(&st.db)
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

    for uid in &dto.user_ids {
        sqlx::query(
            "INSERT INTO chat.conversation_members (conversation_id, user_id, role)
             VALUES ($1, $2, 'member')
             ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL",
        )
        .bind(conv_id)
        .bind(uid)
        .execute(&st.db)
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
    let role: Option<String> = sqlx::query_scalar(
        "SELECT role FROM chat.conversation_members
         WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL",
    )
    .bind(conv_id)
    .bind(user.id)
    .fetch_optional(&st.db)
    .await?;

    let can_remove = matches!(role.as_deref(), Some("admin") | Some("owner"))
        || target_uid == user.id;

    if !can_remove {
        return Err(ChatError::Forbidden);
    }

    sqlx::query(
        "UPDATE chat.conversation_members SET left_at = NOW()
         WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(conv_id)
    .bind(target_uid)
    .execute(&st.db)
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
        sqlx::query("UPDATE chat.conversation_members SET is_pinned = $3 WHERE conversation_id = $1 AND user_id = $2")
            .bind(conv_id).bind(user.id).bind(pin).execute(&st.db).await?;
    }
    if let Some(archive) = dto.archive {
        sqlx::query("UPDATE chat.conversation_members SET is_archived = $3 WHERE conversation_id = $1 AND user_id = $2")
            .bind(conv_id).bind(user.id).bind(archive).execute(&st.db).await?;
    }
    if let Some(fav) = dto.favorite {
        sqlx::query("UPDATE chat.conversation_members SET is_favorite = $3 WHERE conversation_id = $1 AND user_id = $2")
            .bind(conv_id).bind(user.id).bind(fav).execute(&st.db).await?;
    }
    if let Some(until) = dto.mute_until {
        sqlx::query("UPDATE chat.conversation_members SET muted_until = $3 WHERE conversation_id = $1 AND user_id = $2")
            .bind(conv_id).bind(user.id).bind(until).execute(&st.db).await?;
    }
    if dto.unmute == Some(true) {
        sqlx::query("UPDATE chat.conversation_members SET muted_until = NULL WHERE conversation_id = $1 AND user_id = $2")
            .bind(conv_id).bind(user.id).execute(&st.db).await?;
    }
    match dto.mark_unread {
        Some(true) => {
            sqlx::query("UPDATE chat.conversation_members SET last_read_at = '1970-01-01', last_read_message_id = NULL, marked_unread = TRUE WHERE conversation_id = $1 AND user_id = $2")
                .bind(conv_id).bind(user.id).execute(&st.db).await?;
        }
        // Clearing the flag: opening a conversation with no message at all can't go
        // through mark_read (it needs a message id), so it lands here.
        Some(false) => {
            sqlx::query("UPDATE chat.conversation_members SET last_read_at = NOW(), marked_unread = FALSE WHERE conversation_id = $1 AND user_id = $2")
                .bind(conv_id).bind(user.id).execute(&st.db).await?;
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

    sqlx::query(
        "UPDATE chat.messages SET deleted_at = NOW() WHERE conversation_id = $1 AND deleted_at IS NULL",
    )
    .bind(conv_id)
    .execute(&st.db)
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
    let row: Option<(bool, Option<String>)> = sqlx::query_as(
        "SELECT c.is_meeting, m.role
           FROM chat.conversations c
           LEFT JOIN chat.conversation_members m
             ON m.conversation_id = c.id AND m.user_id = $2 AND m.left_at IS NULL
          WHERE c.id = $1",
    )
    .bind(conv_id)
    .bind(user.id)
    .fetch_optional(&st.db)
    .await?;

    let (is_meeting, role) = row.ok_or(ChatError::NotFound(conv_id.to_string()))?;
    if !is_meeting {
        return Err(ChatError::Validation("Cette conversation n'est pas une réunion".into()));
    }
    if !matches!(role.as_deref(), Some("owner") | Some("admin")) {
        return Err(ChatError::Forbidden);
    }

    let value = serde_json::to_value(&dto).unwrap_or_else(|_| json!({}));
    sqlx::query("UPDATE chat.conversations SET meeting_settings = $2 WHERE id = $1")
        .bind(conv_id)
        .bind(&value)
        .execute(&st.db)
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
pub const UNUSED_ROOM: &str = "NOT EXISTS (SELECT 1 FROM chat.messages msg WHERE msg.conversation_id = c.id)
     AND (SELECT COUNT(*) FROM chat.conversation_members cm
           WHERE cm.conversation_id = c.id AND cm.left_at IS NULL) <= 1";

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
    let kept: Option<(Option<chrono::DateTime<chrono::Utc>>,)> = sqlx::query_as(
        "UPDATE chat.conversations
            SET provisional_until = NOW() + make_interval(mins => $2)
          WHERE id = $1 AND provisional_until IS NOT NULL
          RETURNING provisional_until",
    )
    .bind(conv_id)
    .bind(PROVISIONAL_GRACE_MIN)
    .fetch_optional(&st.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "keep_provisional");
        e
    })?;
    // A room that is no longer provisional is not an error: it was confirmed
    // while this call was in flight, which is the outcome we wanted anyway.
    Ok(Json(json!({ "provisional_until": kept.and_then(|r| r.0) })))
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
    sqlx::query("UPDATE chat.conversations SET provisional_until = NULL WHERE id = $1")
        .bind(conv_id)
        .execute(&st.db)
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
    // Audited: the only interpolation is UNUSED_ROOM, a const of this module.
    let deleted = sqlx::query(sqlx::AssertSqlSafe(format!(
        "DELETE FROM chat.conversations c
          WHERE c.id = $1 AND c.provisional_until IS NOT NULL AND {UNUSED_ROOM}"
    )))
    .bind(conv_id)
    .execute(&st.db)
    .await
    .map_err(|e| {
        tracing::error!(error = %e, "drop_provisional");
        e
    })?
    .rows_affected();

    Ok(Json(json!({ "deleted": deleted > 0 })))
}

/// Is this person a host of that meeting? The single place that answers it,
/// so no handler invents its own idea of who may decide.
async fn assert_meeting_host(db: &sqlx::PgPool, conv_id: Uuid, user_id: Uuid) -> ChatResult<()> {
    let row: Option<(bool, Option<String>, Option<Uuid>)> = sqlx::query_as(
        "SELECT c.is_meeting, m.role, c.created_by
           FROM chat.conversations c
           LEFT JOIN chat.conversation_members m
             ON m.conversation_id = c.id AND m.user_id = $2 AND m.left_at IS NULL
          WHERE c.id = $1",
    )
    .bind(conv_id)
    .bind(user_id)
    .fetch_optional(db)
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
    let row: Option<(bool, serde_json::Value)> =
        sqlx::query_as("SELECT is_meeting, meeting_settings FROM chat.conversations WHERE id = $1")
            .bind(conv_id)
            .fetch_optional(&st.db)
            .await?;
    let (is_meeting, settings) = row.ok_or(ChatError::NotFound(conv_id.to_string()))?;
    let s = crate::models::conversation::MeetingSettings::read(&settings);
    if !is_meeting || !s.trusted_only() || !s.allow_knocking {
        return Err(ChatError::Forbidden);
    }

    // Refused twice is refused. A door that can be knocked on forever is a way
    // of knocking until someone gives in; past that, only a deliberate act by
    // the host — adding the person to the room — opens it.
    let refused: Option<(i32,)> = sqlx::query_as(
        "SELECT denied_count FROM chat.meeting_knocks WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(conv_id)
    .bind(user.id)
    .fetch_optional(&st.db)
    .await?;
    if refused.map(|r| r.0).unwrap_or(0) >= MAX_KNOCK_REFUSALS {
        return Err(ChatError::Forbidden);
    }

    let status: (String,) = sqlx::query_as(
        "INSERT INTO chat.meeting_knocks (conversation_id, user_id, status, requested_at)
         VALUES ($1, $2, 'pending', NOW())
         ON CONFLICT (conversation_id, user_id) DO UPDATE
           SET status = CASE WHEN chat.meeting_knocks.status = 'admitted'
                             THEN 'admitted' ELSE 'pending' END,
               requested_at = NOW(),
               decided_at = NULL
         RETURNING status",
    )
    .bind(conv_id)
    .bind(user.id)
    .fetch_one(&st.db)
    .await?;

    Ok(Json(json!({ "status": status.0 })))
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
        let mine: Option<(String, i32)> = sqlx::query_as(
            "SELECT status, denied_count FROM chat.meeting_knocks
              WHERE conversation_id = $1 AND user_id = $2",
        )
        .bind(conv_id)
        .bind(user.id)
        .fetch_optional(&st.db)
        .await?;
        let exhausted = mine.as_ref().map(|r| r.1 >= MAX_KNOCK_REFUSALS).unwrap_or(false);
        return Ok(Json(json!({
            "status": mine.map(|r| r.0),
            "exhausted": exhausted,
        })));
    }

    assert_meeting_host(&st.db, conv_id, user.id).await?;
    let rows: Vec<(Uuid, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
        "SELECT user_id, requested_at FROM chat.meeting_knocks
          WHERE conversation_id = $1 AND status = 'pending'
          ORDER BY requested_at",
    )
    .bind(conv_id)
    .fetch_all(&st.db)
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

    let mut tx = st.db.begin().await?;
    let updated = sqlx::query(
        "UPDATE chat.meeting_knocks SET status = $3, decided_at = NOW()
          WHERE conversation_id = $1 AND user_id = $2 AND status = 'pending'",
    )
    .bind(conv_id)
    .bind(target)
    .bind(if dto.admit { "admitted" } else { "denied" })
    .execute(&mut *tx)
    .await?;

    if !dto.admit {
        sqlx::query(
            "UPDATE chat.meeting_knocks SET denied_count = denied_count + 1
              WHERE conversation_id = $1 AND user_id = $2",
        )
        .bind(conv_id)
        .bind(target)
        .execute(&mut *tx)
        .await?;
    }

    if updated.rows_affected() == 0 {
        tx.rollback().await?;
        return Err(ChatError::NotFound(target.to_string()));
    }

    if dto.admit {
        sqlx::query(
            "INSERT INTO chat.conversation_members (conversation_id, user_id, role)
             VALUES ($1, $2, 'member')
             ON CONFLICT (conversation_id, user_id) DO UPDATE SET left_at = NULL",
        )
        .bind(conv_id)
        .bind(target)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(Json(json!({ "ok": true, "admitted": dto.admit })))
}
