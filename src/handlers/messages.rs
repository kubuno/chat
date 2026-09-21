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
use kubuno_db::dialect::Assign;
use kubuno_db::{new_id, params, DbQueryBuilder};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

/// The floor used where PostgreSQL wrote `'-infinity'::timestamptz`.
fn epoch_floor() -> chrono::DateTime<chrono::Utc> {
    chrono::DateTime::from_timestamp(0, 0).unwrap_or_else(chrono::Utc::now)
}

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
    // A message someone deleted stays in the thread as a tombstone (type
    // `deleted`, empty envelope) so nobody wonders what used to be there.
    // The two automatic purges also tombstone rows, and those must NOT show:
    // an expired ephemeral message is hidden by the `expires_at` clause below,
    // and a row past the instance retention by its age (0 = keep forever).
    let retention_days = st.instance().retention_days;

    // `before` names the oldest message the client already holds. Ids are
    // random UUIDs, so the cursor is resolved to that message's (created_at, id)
    // and the page is everything strictly older in the same order the page is
    // sorted by. The WHERE is built dynamically: `make_interval` and the
    // `hidden_before` subquery / `'-infinity'` become Rust-computed bound values,
    // and the retention window is only added when it is on. Row-value comparison
    // `(a, b) < (c, d)` is portable across the three engines.
    let now = Utc::now();
    // The visibility floor (hidden_before) is read separately rather than as a
    // correlated subquery with an `-infinity` fallback.
    let hidden_before: Option<chrono::DateTime<Utc>> = st
        .db
        .fetch_optional_scalar::<Option<chrono::DateTime<Utc>>>(
            "SELECT hidden_before FROM chat.conversation_members
             WHERE conversation_id = $1 AND user_id = $2",
            params![conv_id, user.id],
        )
        .await?
        .flatten();
    let floor = hidden_before.unwrap_or_else(epoch_floor);

    let mut qb = DbQueryBuilder::new(st.db.backend(), "SELECT m.* FROM chat.messages m WHERE m.conversation_id = ");
    qb.push_bind(conv_id);
    if let Some(before) = params.before {
        qb.push(" AND (m.created_at, m.id) < (SELECT b.created_at, b.id FROM chat.messages b WHERE b.id = ")
            .push_bind(before)
            .push(" AND b.conversation_id = ")
            .push_bind(conv_id)
            .push(")");
    }
    if retention_days > 0 {
        let cutoff = now - Duration::days(retention_days as i64);
        qb.push(" AND (m.deleted_at IS NULL OR m.created_at > ").push_bind(cutoff).push(")");
    }
    qb.push(" AND (m.scheduled_at IS NULL OR m.scheduled_at <= ")
        .push_bind(now)
        .push(" OR m.sender_id = ")
        .push_bind(user.id)
        .push(")");
    qb.push(" AND (m.expires_at IS NULL OR m.expires_at > ").push_bind(now).push(")");
    qb.push(" AND m.created_at > ").push_bind(floor);
    qb.push_order_by("m.created_at DESC, m.id DESC");
    qb.push(" LIMIT ").push_bind(limit);
    let messages: Vec<Message> = qb.fetch_all_as(&st.db).await?;

    // Marquer comme délivré
    message_service::mark_delivered(&st.db, conv_id, user.id).await?;

    // Réactions des messages chargés (pour affichage des compteurs au chargement).
    let ids: Vec<Uuid> = messages.iter().map(|m| m.id).collect();
    let reactions: Vec<(Uuid, Uuid, String)> = if ids.is_empty() {
        Vec::new()
    } else {
        let mut rq = DbQueryBuilder::new(
            st.db.backend(),
            "SELECT message_id, user_id, emoji FROM chat.message_reactions WHERE message_id",
        );
        rq.push_in(ids.iter().copied());
        rq.fetch_all_as(&st.db).await.unwrap_or_default()
    };
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
    let rows: Vec<(Uuid, Option<Uuid>, chrono::DateTime<Utc>)> = st
        .db
        .fetch_all_as(
            "SELECT user_id, last_read_message_id, last_read_at
             FROM chat.conversation_members WHERE conversation_id = $1 AND left_at IS NULL",
            params![conv_id],
        )
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
    let msg: Message = st
        .db
        .fetch_optional_as("SELECT * FROM chat.messages WHERE id = $1 AND deleted_at IS NULL", params![msg_id])
        .await?
        .ok_or_else(|| ChatError::NotFound(msg_id.to_string()))?;

    message_service::assert_member(&st.db, msg.conversation_id, user.id).await?;

    st.db
        .execute(
            // pinned_at is assigned BEFORE is_pinned is flipped: MySQL evaluates
            // SET expressions left to right against already-updated columns, so a
            // `CASE WHEN is_pinned` after the flip would read the new value; the
            // order makes the toggle identical on all three engines.
            "UPDATE chat.messages
             SET pinned_at = CASE WHEN is_pinned THEN NULL ELSE $1 END,
                 is_pinned = NOT is_pinned
             WHERE id = $2",
            params![chrono::Utc::now(), msg_id],
        )
        .await?;
    let updated: Message = st
        .db
        .fetch_one_as("SELECT * FROM chat.messages WHERE id = $1", params![msg_id])
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
    let pinned: Vec<Message> = st
        .db
        .fetch_all_as(
            "SELECT * FROM chat.messages
             WHERE conversation_id = $1 AND is_pinned AND deleted_at IS NULL
             ORDER BY pinned_at DESC",
            params![conv_id],
        )
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

    // Chat moderation: in a moderated meeting, only a host writes. Checked on
    // the SERVER — hiding the composer would stop a person, not a client.
    let room: Option<(bool, serde_json::Value, Option<String>)> = st
        .db
        .fetch_optional_as(
            "SELECT c.is_meeting, c.meeting_settings, m.role
               FROM chat.conversations c
               LEFT JOIN chat.conversation_members m
                 ON m.conversation_id = c.id AND m.user_id = $2 AND m.left_at IS NULL
              WHERE c.id = $1",
            params![conv_id, user.id],
        )
        .await?;
    if let Some((true, settings, role)) = room {
        let s = crate::models::conversation::MeetingSettings::read(&settings);
        let is_host = matches!(role.as_deref(), Some("owner") | Some("admin"));
        if s.restricts() && !s.allow_messages && !is_host {
            return Err(ChatError::Forbidden);
        }
    }

    // The nonce is the client's idempotency key. A retry of the same send
    // (the network dropped mid-POST, an offline relay re-injected the same
    // envelope) gets the message that already exists instead of an error;
    // only a nonce reused by ANOTHER sender is a replay and is refused.
    let existing: Option<Message> = st
        .db
        .fetch_optional_as(
            "SELECT * FROM chat.messages WHERE conversation_id = $1 AND nonce = $2",
            params![conv_id, &dto.nonce],
        )
        .await?;

    if let Some(existing) = existing {
        if existing.sender_id == user.id {
            return Ok(Json(json!({ "message": existing, "duplicate": true })));
        }
        return Err(ChatError::Conflict("Nonce déjà utilisé (anti-replay)".into()));
    }

    let msg_type = dto.message_type.as_deref().unwrap_or("text");

    // Programmé (futur) → invisible aux autres jusqu'à l'échéance ; éphémère → TTL.
    let scheduled = dto.scheduled_at.map(|t| t > Utc::now()).unwrap_or(false);
    // A delay chosen by the author always wins. Otherwise the instance may impose
    // one, which is how an administrator says "keep no lasting history" without
    // ever reading a message. A scheduled message counts from its delivery time,
    // so it can never expire before it is sent.
    let cfg = st.instance();
    let expires_at = dto
        .expires_in_secs
        .filter(|s| *s > 0)
        .map(|s| Utc::now() + Duration::seconds(s))
        .or_else(|| {
            (cfg.default_expiry_hours > 0).then(|| {
                let base = match dto.scheduled_at {
                    Some(t) if scheduled => t,
                    _ => Utc::now(),
                };
                base + Duration::hours(cfg.default_expiry_hours)
            })
        });

    let msg_id = new_id();
    let created_at = Utc::now();
    st.db
        .execute(
            "INSERT INTO chat.messages
             (id, conversation_id, sender_id, encrypted_data, message_type, media_meta,
              reply_to_id, nonce, scheduled_at, expires_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
            params![
                msg_id,
                conv_id,
                user.id,
                &dto.encrypted_data,
                msg_type,
                dto.media_meta.clone(),
                dto.reply_to_id,
                &dto.nonce,
                if scheduled { dto.scheduled_at } else { None },
                expires_at,
                created_at
            ],
        )
        .await?;
    let msg: Message = st
        .db
        .fetch_one_as("SELECT * FROM chat.messages WHERE id = $1", params![msg_id])
        .await?;

    // Marquer OPK comme claimed si X3DH initial
    if let Some(opk_id) = dto.used_opk_id {
        st.db
            .execute(
                "UPDATE chat.one_time_prekeys
                 SET claimed_at = $1, claimed_by = $2
                 WHERE id = $3 AND claimed_at IS NULL",
                params![Utc::now(), user.id, opk_id],
            )
            .await
            .ok();
    }

    // Un message programmé reste privé jusqu'à sa livraison par le worker :
    // pas de bump de conversation, pas de réintégration, pas de broadcast.
    if !scheduled {
        st.db
            .execute(
                "UPDATE chat.conversations SET updated_at = $1 WHERE id = $2",
                params![Utc::now(), conv_id],
            )
            .await?;

        // Pour les DM : réintégrer automatiquement les membres qui avaient quitté.
        let conv_type: Option<String> = st
            .db
            .fetch_optional_scalar(
                "SELECT conv_type FROM chat.conversations WHERE id = $1",
                params![conv_id],
            )
            .await?;

        if conv_type.as_deref() == Some("direct") {
            st.db
                .execute(
                    "UPDATE chat.conversation_members
                     SET left_at = NULL
                     WHERE conversation_id = $1 AND left_at IS NOT NULL",
                    params![conv_id],
                )
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
                // No exclusion: the sender's OTHER tabs and devices must see the
                // message live. The tab that sent it already holds the message
                // (appended from the HTTP response) and drops the duplicate by id.
                None,
            )
            .await;

        // Wake up the recipients' devices through the core (push), content-free.
        crate::events::publisher::emit_new_message(&st, &msg).await;
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
    let msg: Message = st
        .db
        .fetch_optional_as("SELECT * FROM chat.messages WHERE id = $1 AND deleted_at IS NULL", params![msg_id])
        .await?
        .ok_or_else(|| ChatError::NotFound(msg_id.to_string()))?;
    message_service::assert_member(&st.db, msg.conversation_id, user.id).await?;
    if dto.option_index < 0 {
        return Err(ChatError::Validation("option_index invalide".into()));
    }

    let upsert = st.db.backend().upsert(
        "chat.poll_votes",
        &["message_id", "user_id"],
        &[Assign::Incoming("option_index"), Assign::Incoming("voted_at")],
    );
    st.db
        .execute(
            &format!(
                "INSERT INTO chat.poll_votes (message_id, user_id, option_index, voted_at)
                 VALUES ($1, $2, $3, $4){upsert}"
            ),
            params![msg_id, user.id, dto.option_index, chrono::Utc::now()],
        )
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
    let my_vote: Option<i32> = st
        .db
        .fetch_optional_scalar(
            "SELECT option_index FROM chat.poll_votes WHERE message_id = $1 AND user_id = $2",
            params![msg_id, user.id],
        )
        .await?;
    let counts = poll_counts(&st, msg_id).await?;
    Ok(Json(json!({ "counts": counts, "my_vote": my_vote })))
}

/// Compte des votes par index d'option (map index→count).
async fn poll_counts(st: &AppState, msg_id: Uuid) -> ChatResult<Value> {
    let rows: Vec<(i32, i64)> = st
        .db
        .fetch_all_as(
            &format!(
                "SELECT option_index, {} FROM chat.poll_votes WHERE message_id = $1 GROUP BY option_index",
                st.db.backend().count_bigint("*")
            ),
            params![msg_id],
        )
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
    let msg: Option<Message> = st
        .db
        .fetch_optional_as("SELECT * FROM chat.messages WHERE id = $1 AND deleted_at IS NULL", params![msg_id])
        .await?;

    let msg = msg.ok_or_else(|| ChatError::NotFound(msg_id.to_string()))?;

    if msg.sender_id != user.id {
        return Err(ChatError::Forbidden);
    }

    st.db
        .execute(
            "UPDATE chat.messages
             SET encrypted_data = $1, nonce = $2, edited_at = $3
             WHERE id = $4",
            params![&dto.encrypted_data, &dto.nonce, chrono::Utc::now(), msg_id],
        )
        .await?;
    let updated: Message = st
        .db
        .fetch_one_as("SELECT * FROM chat.messages WHERE id = $1", params![msg_id])
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
    let msg: Option<Message> = st
        .db
        .fetch_optional_as("SELECT * FROM chat.messages WHERE id = $1", params![msg_id])
        .await?;

    let msg = msg.ok_or_else(|| ChatError::NotFound(msg_id.to_string()))?;

    if msg.sender_id != user.id {
        // Les admins peuvent aussi supprimer
        let role: Option<String> = st
            .db
            .fetch_optional_scalar(
                "SELECT role FROM chat.conversation_members
                 WHERE conversation_id = $1 AND user_id = $2",
                params![msg.conversation_id, user.id],
            )
            .await?;

        if !matches!(role.as_deref(), Some("admin") | Some("owner")) {
            return Err(ChatError::Forbidden);
        }
    }

    // Effacer le contenu (le message reste comme tombstone)
    st.db
        .execute(
            "UPDATE chat.messages
             SET encrypted_data = '', message_type = 'deleted', deleted_at = $1
             WHERE id = $2",
            params![chrono::Utc::now(), msg_id],
        )
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
    st.db
        .execute(
            "UPDATE chat.conversation_members
             SET last_read_at = $1, last_read_message_id = $2, marked_unread = FALSE
             WHERE conversation_id = $3 AND user_id = $4",
            params![chrono::Utc::now(), dto.up_to_message_id, conv_id, user.id],
        )
        .await?;

    // Insérer les accusés de lecture (placeholders never reused; read_at bound).
    let ignore = st.db.backend().on_conflict_do_nothing(&["message_id", "user_id"]);
    st.db
        .execute(
            &format!(
                "INSERT {}INTO chat.read_receipts (message_id, user_id, read_at)
                 SELECT id, $1, $2 FROM chat.messages
                 WHERE conversation_id = $3
                   AND created_at <= (SELECT created_at FROM chat.messages WHERE id = $4)
                   AND sender_id != $5
                   AND deleted_at IS NULL{ignore}",
                st.db.backend().insert_ignore_prefix()
            ),
            params![user.id, chrono::Utc::now(), conv_id, dto.up_to_message_id, user.id],
        )
        .await?;

    // Tell the sender their messages were read — and the reader's OWN other
    // devices, so a conversation read on one device clears on the others too.
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
            None,
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
    let msg: Message = st
        .db
        .fetch_optional_as("SELECT * FROM chat.messages WHERE id = $1 AND deleted_at IS NULL", params![msg_id])
        .await?
        .ok_or_else(|| ChatError::NotFound(msg_id.to_string()))?;

    message_service::assert_member(&st.db, msg.conversation_id, user.id).await?;

    let ignore = st.db.backend().on_conflict_do_nothing(&["message_id", "user_id", "emoji"]);
    st.db
        .execute(
            &format!(
                "INSERT {}INTO chat.message_reactions (message_id, user_id, emoji, created_at)
                 VALUES ($1, $2, $3, $4){ignore}",
                st.db.backend().insert_ignore_prefix()
            ),
            params![msg_id, user.id, &dto.emoji, chrono::Utc::now()],
        )
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
    let msg: Message = st
        .db
        .fetch_optional_as("SELECT * FROM chat.messages WHERE id = $1", params![msg_id])
        .await?
        .ok_or_else(|| ChatError::NotFound(msg_id.to_string()))?;

    st.db
        .execute(
            "DELETE FROM chat.message_reactions
             WHERE message_id = $1 AND user_id = $2 AND emoji = $3",
            params![msg_id, user.id, &emoji],
        )
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
