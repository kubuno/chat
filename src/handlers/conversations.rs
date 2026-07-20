use crate::errors::{ChatError, ChatResult};
use crate::middleware::ChatUser;
use crate::models::conversation::{
    AddMembersDto, Conversation, ConversationSummary, CreateConversationDto, MemberSettingsDto,
    OtherUserInfo, UpdateConversationDto,
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
                u.username AS other_username, u.avatar_url AS other_avatar
         FROM chat.conversations c
         JOIN chat.conversation_members m
           ON m.conversation_id = c.id AND m.user_id = $1 AND m.left_at IS NULL
         LEFT JOIN core.users u
           ON c.conv_type = 'direct'
          AND u.id = CASE WHEN c.user_a_id = $1 THEN c.user_b_id ELSE c.user_a_id END
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
            ConversationSummary {
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
            let name = dto
                .name
                .filter(|s| !s.is_empty())
                .ok_or_else(|| ChatError::Validation("name requis pour un groupe".into()))?;

            let conv: Conversation = sqlx::query_as(
                "INSERT INTO chat.conversations (conv_type, name, description, created_by, is_meeting)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING *",
            )
            .bind(conv_type)
            .bind(&name)
            .bind(&dto.description)
            .bind(user.id)
            .bind(dto.is_meeting.unwrap_or(false))
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
pub async fn join_meeting(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    let joinable: Option<(bool, String)> =
        sqlx::query_as("SELECT is_meeting, conv_type FROM chat.conversations WHERE id = $1")
            .bind(conv_id)
            .fetch_optional(&st.db)
            .await?;

    match joinable.map(|(meeting, ty)| meeting || ty == "channel") {
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

    let rows: Vec<(Uuid, Option<String>, Option<String>, chrono::DateTime<chrono::Utc>, i64, bool)> = sqlx::query_as(
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
