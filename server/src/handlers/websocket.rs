use crate::middleware::ChatUser;
use crate::services::websocket_hub::{WsEnvelope, WsEvent};
use crate::state::AppState;
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::Response,
};
use futures::{SinkExt, StreamExt};
use kubuno_db::dialect::Backend;
use kubuno_db::params;
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct WsQuery {
    pub conv_id: Option<Uuid>,
}

/// GET /ws — upgrade WebSocket (authentification via headers injectés par le core)
pub async fn ws_handler(
    State(st): State<AppState>,
    user: ChatUser,
    Query(_q): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, st, user))
}

async fn handle_socket(socket: WebSocket, st: AppState, user: ChatUser) {
    let user_id = user.id;
    let (mut sink, mut stream) = socket.split();

    // Abonner ce client au hub
    let mut rx = st.ws_hub.connect(user_id).await;

    // Mettre à jour la présence — un statut choisi à la main (absent / ne pas
    // déranger) prime sur le « en ligne » impliqué par la connexion.
    // A manually chosen Away/DND wins over the "online" implied by connecting.
    // The upsert's UPDATE branch reads the row's current `manual_status`, which
    // the dialect helper spells differently per engine; MySQL lacks RETURNING,
    // so the effective status is re-selected there instead.
    let now = chrono::Utc::now();
    // `last_seen_at` in the UPDATE branch is a THIRD placeholder (bound to the
    // same `now`): sql::prepare forbids reusing $2 from the VALUES list.
    let conflict = match st.db.backend() {
        Backend::Postgres | Backend::Sqlite => {
            " ON CONFLICT (user_id) DO UPDATE \
              SET status = COALESCE(chat.presence.manual_status, 'online'), last_seen_at = $3"
        }
        Backend::MySql => {
            " ON DUPLICATE KEY UPDATE \
              status = COALESCE(manual_status, 'online'), last_seen_at = $3"
        }
    };
    let insert = format!(
        "INSERT INTO chat.presence (user_id, status, last_seen_at) VALUES ($1, 'online', $2){conflict}"
    );
    let effective: String = if st.db.backend().supports_returning() {
        st.db
            .fetch_scalar::<String>(&format!("{insert} RETURNING status"), params![user_id, now, now])
            .await
            .unwrap_or_else(|e| {
                tracing::error!(error = %e, "ws presence upsert");
                "online".to_string()
            })
    } else {
        match st.db.execute(&insert, params![user_id, now, now]).await {
            Ok(_) => st
                .db
                .fetch_optional_scalar::<String>(
                    "SELECT status FROM chat.presence WHERE user_id = $1",
                    params![user_id],
                )
                .await
                .ok()
                .flatten()
                .unwrap_or_else(|| "online".to_string()),
            Err(e) => {
                tracing::error!(error = %e, "ws presence upsert");
                "online".to_string()
            }
        }
    };

    // Notifier les contacts du statut effectif
    broadcast_presence(&st, user_id, &effective).await;

    // Task: recevoir du hub et envoyer au client
    let mut send_task = tokio::spawn(async move {
        while let Ok(env) = rx.recv().await {
            if let Ok(json_str) = serde_json::to_string(&env) {
                if sink.send(Message::Text(json_str)).await.is_err() {
                    break;
                }
            }
        }
    });

    // Task: recevoir du client (ping/typing/signaux)
    let st2 = st.clone();
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = stream.next().await {
            match msg {
                Message::Text(txt) => {
                    handle_client_message(&st2, user_id, &txt).await;
                }
                Message::Close(_) => break,
                Message::Ping(data) => {
                    // Le sink est consommé par send_task — on ignore le pong ici
                    let _ = data;
                }
                _ => {}
            }
        }
    });

    // Attendre que l'une des deux tâches se termine
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }

    // Déconnexion: mettre à jour la présence
    st.ws_hub.disconnect(user_id).await;

    st.db
        .execute(
            "UPDATE chat.presence SET status = 'offline', last_seen_at = $1 WHERE user_id = $2",
            params![chrono::Utc::now(), user_id],
        )
        .await
        .ok();

    broadcast_presence(&st, user_id, "offline").await;
}

async fn handle_client_message(st: &AppState, user_id: Uuid, raw: &str) {
    let Ok(val) = serde_json::from_str::<Value>(raw) else { return };

    let action = val.get("action").and_then(|v| v.as_str()).unwrap_or("");

    match action {
        "typing_start" | "typing_stop" => {
            let Some(conv_id) = val.get("conversation_id").and_then(|v| v.as_str()).and_then(|s| Uuid::parse_str(s).ok()) else { return };

            let members: Vec<Uuid> = st
                .db
                .fetch_all_as::<(Uuid,)>(
                    "SELECT user_id FROM chat.conversation_members
                     WHERE conversation_id = $1 AND left_at IS NULL",
                    params![conv_id],
                )
                .await
                .unwrap_or_default()
                .into_iter()
                .map(|(id,)| id)
                .collect();

            let event = if action == "typing_start" { WsEvent::TypingStart } else { WsEvent::TypingStop };
            let env = WsEnvelope {
                event,
                payload: json!({ "conversation_id": conv_id, "user_id": user_id }),
            };
            st.ws_hub.send_to_many(&members, env, Some(user_id)).await;
        }
        "call_signal" => {
            let Some(to_user) = val.get("to_user_id").and_then(|v| v.as_str()).and_then(|s| Uuid::parse_str(s).ok()) else { return };
            let env = WsEnvelope {
                event:   WsEvent::CallSignal,
                payload: json!({ "from_user_id": user_id, "signal": val.get("signal") }),
            };
            st.ws_hub.send_to(to_user, env).await;

            // A ring also reaches the callee's asleep devices through the core
            // push, so a native client can show its incoming-call screen.
            let signal = val.get("signal");
            let kind = signal.and_then(|s| s.get("type")).and_then(|v| v.as_str());
            let room = signal.and_then(|s| s.get("room")).and_then(|v| v.as_str()).and_then(|s| Uuid::parse_str(s).ok());
            if let (Some("call_ring"), Some(room)) = (kind, room) {
                let call_type = signal.and_then(|s| s.get("call_type")).and_then(|v| v.as_str()).unwrap_or("audio");
                crate::events::publisher::emit_call_ring(st, room, user_id, to_user, call_type).await;
            }
        }
        _ => {}
    }
}

async fn broadcast_presence(st: &AppState, user_id: Uuid, status: &str) {
    // Trouver tous les users qui ont une conversation avec cet user
    let contacts: Vec<Uuid> = st
        .db
        .fetch_all_as::<(Uuid,)>(
            "SELECT DISTINCT
                 CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END
             FROM chat.conversations
             WHERE conv_type = 'direct'
               AND (user_a_id = $2 OR user_b_id = $3)",
            params![user_id, user_id, user_id],
        )
        .await
        .unwrap_or_default()
        .into_iter()
        .map(|(id,)| id)
        .collect();

    if !contacts.is_empty() {
        let env = WsEnvelope {
            event:   WsEvent::PresenceUpdate,
            payload: json!({ "user_id": user_id, "status": status }),
        };
        st.ws_hub.send_to_many(&contacts, env, None).await;
    }
}
