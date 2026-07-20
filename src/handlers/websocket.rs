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
    let effective: String = sqlx::query_scalar(
        "INSERT INTO chat.presence (user_id, status, last_seen_at)
         VALUES ($1, 'online', NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET status = COALESCE(chat.presence.manual_status, 'online'), last_seen_at = NOW()
         RETURNING status",
    )
    .bind(user_id)
    .fetch_one(&st.db)
    .await
    .unwrap_or_else(|e| {
        tracing::error!(error = %e, "ws presence upsert");
        "online".to_string()
    });

    // Notifier les contacts du statut effectif
    broadcast_presence(&st, user_id, &effective).await;

    // Task: recevoir du hub et envoyer au client
    let mut send_task = tokio::spawn(async move {
        while let Ok(env) = rx.recv().await {
            if let Ok(json_str) = serde_json::to_string(&env) {
                if sink.send(Message::Text(json_str.into())).await.is_err() {
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

    sqlx::query(
        "UPDATE chat.presence SET status = 'offline', last_seen_at = NOW()
         WHERE user_id = $1",
    )
    .bind(user_id)
    .execute(&st.db)
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

            let members: Vec<Uuid> = sqlx::query_scalar(
                "SELECT user_id FROM chat.conversation_members
                 WHERE conversation_id = $1 AND left_at IS NULL",
            )
            .bind(conv_id)
            .fetch_all(&st.db)
            .await
            .unwrap_or_default();

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
        }
        _ => {}
    }
}

async fn broadcast_presence(st: &AppState, user_id: Uuid, status: &str) {
    // Trouver tous les users qui ont une conversation avec cet user
    let contacts: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT
             CASE WHEN user_a_id = $1 THEN user_b_id ELSE user_a_id END
         FROM chat.conversations
         WHERE conv_type = 'direct'
           AND (user_a_id = $1 OR user_b_id = $1)",
    )
    .bind(user_id)
    .fetch_all(&st.db)
    .await
    .unwrap_or_default();

    if !contacts.is_empty() {
        let env = WsEnvelope {
            event:   WsEvent::PresenceUpdate,
            payload: json!({ "user_id": user_id, "status": status }),
        };
        st.ws_hub.send_to_many(&contacts, env, None).await;
    }
}
