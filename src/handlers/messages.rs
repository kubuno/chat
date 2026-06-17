use crate::errors::{ChatError, ChatResult};
use crate::middleware::ChatUser;
use crate::models::message::{EditMessageDto, Message, ReadReceiptDto, ReactionDto, SendMessageDto, VoteDto};
use chrono::{Duration, Utc};
use crate::services::{message_service, websocket_hub::{WsEnvelope, WsEvent}};
use crate::state::AppState;
use axum::{
    extract::{Path, Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct PaginationParams {
    pub limit:  Option<i64>,
    pub before: Option<Uuid>,
}

/// GET /conversations/:id/messages — historique paginé (chiffré, opaque)
pub async fn list_messages(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
    Query(params): Query<PaginationParams>,
) -> ChatResult<Json<Value>> {
    message_service::assert_member(&st.db, conv_id, user.id).await?;

    let limit = params.limit.unwrap_or(st.settings.chat.messages_page_size as i64).min(200);

    let messages: Vec<Message> = if let Some(before) = params.before {
        sqlx::query_as(
            "SELECT m.* FROM chat.messages m
             WHERE m.conversation_id = $1
               AND m.id < $2
               AND m.deleted_at IS NULL
               AND (m.scheduled_at IS NULL OR m.scheduled_at <= NOW() OR m.sender_id = $4)
               AND (m.expires_at IS NULL OR m.expires_at > NOW())
               AND m.created_at > COALESCE(
                   (SELECT hidden_before FROM chat.conversation_members
                    WHERE conversation_id = $1 AND user_id = $4),
                   '-infinity'::timestamptz
               )
             ORDER BY m.created_at DESC
             LIMIT $3",
        )
        .bind(conv_id)
        .bind(before)
        .bind(limit)
        .bind(user.id)
        .fetch_all(&st.db)
        .await?
    } else {
        sqlx::query_as(
            "SELECT m.* FROM chat.messages m
             WHERE m.conversation_id = $1
               AND m.deleted_at IS NULL
               AND (m.scheduled_at IS NULL OR m.scheduled_at <= NOW() OR m.sender_id = $3)
               AND (m.expires_at IS NULL OR m.expires_at > NOW())
               AND m.created_at > COALESCE(
                   (SELECT hidden_before FROM chat.conversation_members
                    WHERE conversation_id = $1 AND user_id = $3),
                   '-infinity'::timestamptz
               )
             ORDER BY m.created_at DESC
             LIMIT $2",
        )
        .bind(conv_id)
        .bind(limit)
        .bind(user.id)
        .fetch_all(&st.db)
        .await?
    };

    // Marquer comme délivré
    message_service::mark_delivered(&st.db, conv_id, user.id).await?;

    // Réactions des messages chargés (pour affichage des compteurs au chargement).
    let ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();
    let reactions: Vec<(Uuid, Uuid, String)> = sqlx::query_as(
        "SELECT message_id, user_id, emoji FROM chat.message_reactions WHERE message_id = ANY($1)",
    )
    .bind(&ids)
    .fetch_all(&st.db)
    .await
    .unwrap_or_default();
    let reactions: Vec<Value> = reactions
        .into_iter()
        .map(|(message_id, user_id, emoji)| json!({ "message_id": message_id, "user_id": user_id, "emoji": emoji }))
        .collect();

    Ok(Json(json!({ "messages": messages, "reactions": reactions })))
}

/// GET /conversations/:id/read-state — position de lecture de chaque membre
/// (pour l'indicateur « Vu par … » dans les groupes).
pub async fn read_state(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    message_service::assert_member(&st.db, conv_id, user.id).await?;
    let rows: Vec<(Uuid, Option<Uuid>, chrono::DateTime<Utc>)> = sqlx::query_as(
        "SELECT user_id, last_read_message_id, last_read_at
         FROM chat.conversation_members WHERE conversation_id = $1 AND left_at IS NULL",
    )
    .bind(conv_id)
    .fetch_all(&st.db)
    .await?;
    let members: Vec<Value> = rows
        .into_iter()
        .map(|(uid, lrm, lra)| json!({ "user_id": uid, "last_read_message_id": lrm, "last_read_at": lra }))
        .collect();
    Ok(Json(json!({ "members": members })))
}

/// POST /messages/:id/pin — épingler / désépingler un message (bascule).
pub async fn pin_message(
    State(st): State<AppState>,
    user: ChatUser,
    Path(msg_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    let msg: Message = sqlx::query_as("SELECT * FROM chat.messages WHERE id = $1 AND deleted_at IS NULL")
        .bind(msg_id)
        .fetch_optional(&st.db)
        .await?
        .ok_or_else(|| ChatError::NotFound(msg_id.to_string()))?;

    message_service::assert_member(&st.db, msg.conversation_id, user.id).await?;

    let updated: Message = sqlx::query_as(
        "UPDATE chat.messages
         SET is_pinned = NOT is_pinned,
             pinned_at = CASE WHEN is_pinned THEN NULL ELSE NOW() END
         WHERE id = $1
         RETURNING *",
    )
    .bind(msg_id)
    .fetch_one(&st.db)
    .await?;

    let members = message_service::get_member_ids(&st.db, msg.conversation_id).await?;
    st.ws_hub
        .send_to_many(
            &members,
            WsEnvelope { event: WsEvent::MessageUpdated, payload: json!({ "message": updated }) },
            None,
        )
        .await;

    Ok(Json(json!({ "message": updated })))
}

/// GET /conversations/:id/pinned — liste des messages épinglés (récents d'abord).
pub async fn list_pinned(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    message_service::assert_member(&st.db, conv_id, user.id).await?;
    let pinned: Vec<Message> = sqlx::query_as(
        "SELECT * FROM chat.messages
         WHERE conversation_id = $1 AND is_pinned AND deleted_at IS NULL
         ORDER BY pinned_at DESC",
    )
    .bind(conv_id)
    .fetch_all(&st.db)
    .await?;
    Ok(Json(json!({ "messages": pinned })))
}

/// POST /conversations/:id/messages — envoyer un message chiffré
pub async fn send_message(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
    Json(dto): Json<SendMessageDto>,
) -> ChatResult<Json<Value>> {
    message_service::assert_member(&st.db, conv_id, user.id).await?;

    // Anti-replay : vérifier le nonce
    let nonce_exists: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM chat.messages WHERE conversation_id = $1 AND nonce = $2",
    )
    .bind(conv_id)
    .bind(&dto.nonce)
    .fetch_optional(&st.db)
    .await?;

    if nonce_exists.is_some() {
        return Err(ChatError::Conflict("Nonce déjà utilisé (anti-replay)".into()));
    }

    let msg_type = dto.message_type.as_deref().unwrap_or("text");

    // Programmé (futur) → invisible aux autres jusqu'à l'échéance ; éphémère → TTL.
    let scheduled = dto.scheduled_at.map(|t| t > Utc::now()).unwrap_or(false);
    let expires_at = dto.expires_in_secs.filter(|s| *s > 0).map(|s| Utc::now() + Duration::seconds(s));

    let msg: Message = sqlx::query_as(
        "INSERT INTO chat.messages
         (conversation_id, sender_id, encrypted_data, message_type, media_meta,
          reply_to_id, nonce, scheduled_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *",
    )
    .bind(conv_id)
    .bind(user.id)
    .bind(&dto.encrypted_data)
    .bind(msg_type)
    .bind(&dto.media_meta)
    .bind(dto.reply_to_id)
    .bind(&dto.nonce)
    .bind(if scheduled { dto.scheduled_at } else { None })
    .bind(expires_at)
    .fetch_one(&st.db)
    .await?;

    // Marquer OPK comme claimed si X3DH initial
    if let Some(opk_id) = dto.used_opk_id {
        sqlx::query(
            "UPDATE chat.one_time_prekeys
             SET claimed_at = NOW(), claimed_by = $2
             WHERE id = $1 AND claimed_at IS NULL",
        )
        .bind(opk_id)
        .bind(user.id)
        .execute(&st.db)
        .await
        .ok();
    }

    // Un message programmé reste privé jusqu'à sa livraison par le worker :
    // pas de bump de conversation, pas de réintégration, pas de broadcast.
    if !scheduled {
        sqlx::query("UPDATE chat.conversations SET updated_at = NOW() WHERE id = $1")
            .bind(conv_id)
            .execute(&st.db)
            .await?;

        // Pour les DM : réintégrer automatiquement les membres qui avaient quitté.
        let conv_type: Option<String> = sqlx::query_scalar(
            "SELECT conv_type FROM chat.conversations WHERE id = $1",
        )
        .bind(conv_id)
        .fetch_optional(&st.db)
        .await?;

        if conv_type.as_deref() == Some("direct") {
            sqlx::query(
                "UPDATE chat.conversation_members
                 SET left_at = NULL
                 WHERE conversation_id = $1 AND left_at IS NOT NULL",
            )
            .bind(conv_id)
            .execute(&st.db)
            .await?;
        }

        let members = message_service::get_member_ids(&st.db, conv_id).await?;
        let payload = json!({
            "message":      msg,
            "ephemeral_key": dto.ephemeral_key,
            "sender_ik_pub": dto.sender_ik_pub,
            "ratchet_header": dto.ratchet_header,
        });
        st.ws_hub
            .send_to_many(
                &members,
                WsEnvelope { event: WsEvent::NewMessage, payload },
                Some(user.id),
            )
            .await;
    }

    Ok(Json(json!({ "message": msg })))
}

/// POST /messages/:id/vote — voter (ou changer son vote) sur un sondage.
pub async fn vote_poll(
    State(st): State<AppState>,
    user: ChatUser,
    Path(msg_id): Path<Uuid>,
    Json(dto): Json<VoteDto>,
) -> ChatResult<Json<Value>> {
    let msg: Message = sqlx::query_as("SELECT * FROM chat.messages WHERE id = $1 AND deleted_at IS NULL")
        .bind(msg_id)
        .fetch_optional(&st.db)
        .await?
        .ok_or_else(|| ChatError::NotFound(msg_id.to_string()))?;
    message_service::assert_member(&st.db, msg.conversation_id, user.id).await?;
    if dto.option_index < 0 {
        return Err(ChatError::Validation("option_index invalide".into()));
    }

    sqlx::query(
        "INSERT INTO chat.poll_votes (message_id, user_id, option_index)
         VALUES ($1, $2, $3)
         ON CONFLICT (message_id, user_id) DO UPDATE SET option_index = $3, voted_at = NOW()",
    )
    .bind(msg_id)
    .bind(user.id)
    .bind(dto.option_index)
    .execute(&st.db)
    .await?;

    let counts = poll_counts(&st, msg_id).await?;
    let members = message_service::get_member_ids(&st.db, msg.conversation_id).await?;
    st.ws_hub
        .send_to_many(
            &members,
            WsEnvelope { event: WsEvent::PollUpdate, payload: json!({ "message_id": msg_id, "counts": counts }) },
            None,
        )
        .await;

    Ok(Json(json!({ "counts": counts, "my_vote": dto.option_index })))
}

/// GET /messages/:id/poll — résultats agrégés d'un sondage + mon vote.
pub async fn poll_results(
    State(st): State<AppState>,
    user: ChatUser,
    Path(msg_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    let my_vote: Option<i32> = sqlx::query_scalar(
        "SELECT option_index FROM chat.poll_votes WHERE message_id = $1 AND user_id = $2",
    )
    .bind(msg_id)
    .bind(user.id)
    .fetch_optional(&st.db)
    .await?;
    let counts = poll_counts(&st, msg_id).await?;
    Ok(Json(json!({ "counts": counts, "my_vote": my_vote })))
}

/// Compte des votes par index d'option (map index→count).
async fn poll_counts(st: &AppState, msg_id: Uuid) -> ChatResult<Value> {
    let rows: Vec<(i32, i64)> = sqlx::query_as(
        "SELECT option_index, COUNT(*) FROM chat.poll_votes WHERE message_id = $1 GROUP BY option_index",
    )
    .bind(msg_id)
    .fetch_all(&st.db)
    .await?;
    let mut map = serde_json::Map::new();
    for (idx, cnt) in rows {
        map.insert(idx.to_string(), json!(cnt));
    }
    Ok(Value::Object(map))
}

/// PATCH /messages/:id — éditer un message
pub async fn edit_message(
    State(st): State<AppState>,
    user: ChatUser,
    Path(msg_id): Path<Uuid>,
    Json(dto): Json<EditMessageDto>,
) -> ChatResult<Json<Value>> {
    let msg: Option<Message> =
        sqlx::query_as("SELECT * FROM chat.messages WHERE id = $1 AND deleted_at IS NULL")
            .bind(msg_id)
            .fetch_optional(&st.db)
            .await?;

    let msg = msg.ok_or_else(|| ChatError::NotFound(msg_id.to_string()))?;

    if msg.sender_id != user.id {
        return Err(ChatError::Forbidden);
    }

    let updated: Message = sqlx::query_as(
        "UPDATE chat.messages
         SET encrypted_data = $2, nonce = $3, edited_at = NOW()
         WHERE id = $1
         RETURNING *",
    )
    .bind(msg_id)
    .bind(&dto.encrypted_data)
    .bind(&dto.nonce)
    .fetch_one(&st.db)
    .await?;

    let members = message_service::get_member_ids(&st.db, msg.conversation_id).await?;
    st.ws_hub
        .send_to_many(
            &members,
            WsEnvelope {
                event:   WsEvent::MessageUpdated,
                payload: json!({ "message": updated }),
            },
            None,
        )
        .await;

    Ok(Json(json!({ "message": updated })))
}

/// DELETE /messages/:id — supprimer pour tous
pub async fn delete_message(
    State(st): State<AppState>,
    user: ChatUser,
    Path(msg_id): Path<Uuid>,
) -> ChatResult<Json<Value>> {
    let msg: Option<Message> =
        sqlx::query_as("SELECT * FROM chat.messages WHERE id = $1")
            .bind(msg_id)
            .fetch_optional(&st.db)
            .await?;

    let msg = msg.ok_or_else(|| ChatError::NotFound(msg_id.to_string()))?;

    if msg.sender_id != user.id {
        // Les admins peuvent aussi supprimer
        let role: Option<String> = sqlx::query_scalar(
            "SELECT role FROM chat.conversation_members
             WHERE conversation_id = $1 AND user_id = $2",
        )
        .bind(msg.conversation_id)
        .bind(user.id)
        .fetch_optional(&st.db)
        .await?;

        if !matches!(role.as_deref(), Some("admin") | Some("owner")) {
            return Err(ChatError::Forbidden);
        }
    }

    // Effacer le contenu (le message reste comme tombstone)
    sqlx::query(
        "UPDATE chat.messages
         SET encrypted_data = '', message_type = 'deleted', deleted_at = NOW()
         WHERE id = $1",
    )
    .bind(msg_id)
    .execute(&st.db)
    .await?;

    let members = message_service::get_member_ids(&st.db, msg.conversation_id).await?;
    st.ws_hub
        .send_to_many(
            &members,
            WsEnvelope {
                event:   WsEvent::MessageUpdated,
                payload: json!({ "message_id": msg_id, "deleted": true }),
            },
            None,
        )
        .await;

    Ok(Json(json!({ "ok": true })))
}

/// POST /conversations/:id/read — marquer comme lu jusqu'à un message
pub async fn mark_read(
    State(st): State<AppState>,
    user: ChatUser,
    Path(conv_id): Path<Uuid>,
    Json(dto): Json<ReadReceiptDto>,
) -> ChatResult<Json<Value>> {
    message_service::assert_member(&st.db, conv_id, user.id).await?;

    // Mettre à jour last_read
    sqlx::query(
        "UPDATE chat.conversation_members
         SET last_read_at = NOW(), last_read_message_id = $3
         WHERE conversation_id = $1 AND user_id = $2",
    )
    .bind(conv_id)
    .bind(user.id)
    .bind(dto.up_to_message_id)
    .execute(&st.db)
    .await?;

    // Insérer les accusés de lecture
    sqlx::query(
        "INSERT INTO chat.read_receipts (message_id, user_id)
         SELECT id, $2 FROM chat.messages
         WHERE conversation_id = $1
           AND created_at <= (SELECT created_at FROM chat.messages WHERE id = $3)
           AND sender_id != $2
           AND deleted_at IS NULL
         ON CONFLICT DO NOTHING",
    )
    .bind(conv_id)
    .bind(user.id)
    .bind(dto.up_to_message_id)
    .execute(&st.db)
    .await?;

    // Notifier l'expéditeur que ses messages ont été lus
    let members = message_service::get_member_ids(&st.db, conv_id).await?;
    st.ws_hub
        .send_to_many(
            &members,
            WsEnvelope {
                event:   WsEvent::MessageRead,
                payload: json!({
                    "conversation_id": conv_id,
                    "reader_id":       user.id,
                    "up_to":           dto.up_to_message_id,
                }),
            },
            Some(user.id),
        )
        .await;

    Ok(Json(json!({ "ok": true })))
}

/// POST /messages/:id/reactions — ajouter une réaction
pub async fn add_reaction(
    State(st): State<AppState>,
    user: ChatUser,
    Path(msg_id): Path<Uuid>,
    Json(dto): Json<ReactionDto>,
) -> ChatResult<Json<Value>> {
    let msg: Message =
        sqlx::query_as("SELECT * FROM chat.messages WHERE id = $1 AND deleted_at IS NULL")
            .bind(msg_id)
            .fetch_optional(&st.db)
            .await?
            .ok_or_else(|| ChatError::NotFound(msg_id.to_string()))?;

    message_service::assert_member(&st.db, msg.conversation_id, user.id).await?;

    sqlx::query(
        "INSERT INTO chat.message_reactions (message_id, user_id, emoji)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING",
    )
    .bind(msg_id)
    .bind(user.id)
    .bind(&dto.emoji)
    .execute(&st.db)
    .await?;

    let members = message_service::get_member_ids(&st.db, msg.conversation_id).await?;
    st.ws_hub
        .send_to_many(
            &members,
            WsEnvelope {
                event:   WsEvent::ReactionUpdate,
                payload: json!({
                    "message_id": msg_id,
                    "user_id":    user.id,
                    "emoji":      dto.emoji,
                    "action":     "add",
                }),
            },
            None,
        )
        .await;

    Ok(Json(json!({ "ok": true })))
}

/// DELETE /messages/:id/reactions/:emoji — retirer une réaction
pub async fn remove_reaction(
    State(st): State<AppState>,
    user: ChatUser,
    Path((msg_id, emoji)): Path<(Uuid, String)>,
) -> ChatResult<Json<Value>> {
    let msg: Message =
        sqlx::query_as("SELECT * FROM chat.messages WHERE id = $1")
            .bind(msg_id)
            .fetch_optional(&st.db)
            .await?
            .ok_or_else(|| ChatError::NotFound(msg_id.to_string()))?;

    sqlx::query(
        "DELETE FROM chat.message_reactions
         WHERE message_id = $1 AND user_id = $2 AND emoji = $3",
    )
    .bind(msg_id)
    .bind(user.id)
    .bind(&emoji)
    .execute(&st.db)
    .await?;

    let members = message_service::get_member_ids(&st.db, msg.conversation_id).await?;
    st.ws_hub
        .send_to_many(
            &members,
            WsEnvelope {
                event:   WsEvent::ReactionUpdate,
                payload: json!({
                    "message_id": msg_id,
                    "user_id":    user.id,
                    "emoji":      emoji,
                    "action":     "remove",
                }),
            },
            None,
        )
        .await;

    Ok(Json(json!({ "ok": true })))
}
