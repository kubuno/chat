use crate::config::Settings;
use crate::services::websocket_hub::WsHub;
use kubuno_storage::StorageBackend;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db:       PgPool,
    pub settings: Arc<Settings>,
    pub ws_hub:   Arc<WsHub>,
    pub storage:  Arc<dyn StorageBackend>,
}
