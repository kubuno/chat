use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct WsEnvelope {
    pub event:   WsEvent,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WsEvent {
    NewMessage,
    MessageDelivered,
    MessageRead,
    MessageUpdated,
    TypingStart,
    TypingStop,
    PresenceUpdate,
    ReactionUpdate,
    CallSignal,
    KeyDistribution,
    PreKeyRefillNeeded,
    ConversationCreated,
}

#[derive(Clone)]
pub struct WsHub {
    // user_id → broadcast sender (multi-onglets/appareils)
    connections: Arc<RwLock<HashMap<Uuid, broadcast::Sender<WsEnvelope>>>>,
}

impl WsHub {
    pub fn new() -> Self {
        WsHub {
            connections: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Créer ou obtenir un receiver pour un user (ajoute une connexion)
    pub async fn connect(&self, user_id: Uuid) -> broadcast::Receiver<WsEnvelope> {
        let mut conns = self.connections.write().await;
        let tx = conns
            .entry(user_id)
            .or_insert_with(|| broadcast::channel(128).0);
        tx.subscribe()
    }

    /// Retirer la connexion d'un user (si plus d'abonnés)
    pub async fn disconnect(&self, user_id: Uuid) {
        let mut conns = self.connections.write().await;
        if let Some(tx) = conns.get(&user_id) {
            if tx.receiver_count() == 0 {
                conns.remove(&user_id);
            }
        }
    }

    /// Envoyer un event à un user spécifique
    pub async fn send_to(&self, user_id: Uuid, env: WsEnvelope) {
        let conns = self.connections.read().await;
        if let Some(tx) = conns.get(&user_id) {
            tx.send(env).ok();
        }
    }

    /// Envoyer à plusieurs users (ex: tous les membres d'une conversation)
    pub async fn send_to_many(&self, user_ids: &[Uuid], env: WsEnvelope, exclude: Option<Uuid>) {
        for uid in user_ids {
            if Some(*uid) == exclude {
                continue;
            }
            self.send_to(*uid, env.clone()).await;
        }
    }

    /// Vérifier si un user est connecté (en ligne)
    pub async fn is_online(&self, user_id: Uuid) -> bool {
        let conns = self.connections.read().await;
        conns
            .get(&user_id)
            .map(|tx| tx.receiver_count() > 0)
            .unwrap_or(false)
    }
}

impl Default for WsHub {
    fn default() -> Self {
        Self::new()
    }
}
