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
pub async fn list_conversations(
    State(st): State<AppState>,
    user: ChatUser,
) -> ChatResult<Json<Value>> {
    let convs = sqlx::query_as::<_, Conversation>(
        "SELECT c.* FROM chat.conversations c
         JOIN chat.conversation_members m ON m.conversation_id = c.id
         WHERE m.user_id = $1 AND m.left_at IS NULL
         ORDER BY c.updated_at DESC",
    )
    .bind(user.id)
    .fetch_all(&st.db)
    .await?;

    let mut summaries = Vec::with_capacity(convs.len());
    for conv in convs {
        let unread: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM chat.messages msg
             WHERE msg.conversation_id = $1
               AND msg.sender_id != $2
               AND msg.created_at > (
                   SELECT last_read_at FROM chat.conversation_members
                   WHERE conversation_id = $1 AND user_id = $2
               )
               AND msg.deleted_at IS NULL",
        )
        .bind(conv.id)
        .bind(user.id)
        .fetch_one(&st.db)
        .await
        .unwrap_or(0);

        let member_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM chat.conversation_members
             WHERE conversation_id = $1 AND left_at IS NULL",
        )
        .bind(conv.id)
        .fetch_one(&st.db)
        .await
        .unwrap_or(0);

        #[derive(sqlx::FromRow)]
        struct MemberPrefs {
            is_pinned:   bool,
            is_archived: bool,
            is_favorite: bool,
            muted_until: Option<chrono::DateTime<chrono::Utc>>,
        }
        let prefs = sqlx::query_as::<_, MemberPrefs>(
            "SELECT is_pinned, is_archived, is_favorite, muted_until
             FROM chat.conversation_members
             WHERE conversation_id = $1 AND user_id = $2",
        )
        .bind(conv.id)
        .bind(user.id)
        .fetch_optional(&st.db)
        .await
        .ok()
        .flatten()
        .unwrap_or(MemberPrefs { is_pinned: false, is_archived: false, is_favorite: false, muted_until: None });

        // Pour les conv directes, récupérer le profil de l'interlocuteur
        let other_user = if conv.conv_type == "direct" {
            let other_id = if conv.user_a_id == Some(user.id) { conv.user_b_id } else { conv.user_a_id };
            if let Some(oid) = other_id {
                #[derive(sqlx::FromRow)]
                struct UserRow { id: uuid::Uuid, display_name: Option<String>, username: String, avatar_url: Option<String> }
                sqlx::query_as::<_, UserRow>(
                    "SELECT id, display_name, username, avatar_url FROM core.users WHERE id = $1",
                )
                .bind(oid)
                .fetch_optional(&st.db)
                .await
                .ok()
                .flatten()
                .map(|u| OtherUserInfo { id: u.id, display_name: u.display_name, username: u.username, avatar_url: u.avatar_url })
            } else { None }
        } else { None };

        summaries.push(ConversationSummary {
            conversation: conv,
            unread_count: unread,
            member_count,
            is_pinned:   prefs.is_pinned,
            is_archived: prefs.is_archived,
            is_favorite: prefs.is_favorite,
            muted_until: prefs.muted_until,
            other_user,
        });
    }

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

/// POST /conversations/:id/join — rejoindre une SALLE DE RÉUNION par son lien.
/// Jointure ouverte réservée aux conversations `is_meeting` (sinon 403).
pub async fn join_meeting(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    let is_meeting: Option<bool> =
        sqlx::query_scalar("SELECT is_meeting FROM chat.conversations WHERE id = $1")
            .bind(conv_id)
            .fetch_optional(&st.db)
            .await?;

    match is_meeting {
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
    if dto.mark_unread == Some(true) {
        sqlx::query("UPDATE chat.conversation_members SET last_read_at = '1970-01-01', last_read_message_id = NULL WHERE conversation_id = $1 AND user_id = $2")
            .bind(conv_id).bind(user.id).execute(&st.db).await?;
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
