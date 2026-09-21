use crate::config::instance::InstanceConfig;
use crate::config::Settings;
use crate::services::websocket_hub::WsHub;
use kubuno_storage::StorageBackend;
use kubuno_db::DbPool;
use std::sync::{Arc, RwLock};

#[derive(Clone)]
pub struct AppState {
    pub db:       DbPool,
    pub settings: Arc<Settings>,
    pub ws_hub:   Arc<WsHub>,
    pub storage:  Arc<dyn StorageBackend>,
    /// Instance settings from the admin console, refreshed in the background so
    /// an edit takes effect without restarting the module. Read through
    /// [`AppState::instance`], never locked directly by callers.
    pub instance: Arc<RwLock<InstanceConfig>>,
}

impl AppState {
    /// A snapshot of the current instance settings. Falls back to the compiled
    /// defaults if the lock was poisoned by a panicking writer.
    pub fn instance(&self) -> InstanceConfig {
        self.instance.read().map(|c| c.clone()).unwrap_or_default()
    }
}
