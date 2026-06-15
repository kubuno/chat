use anyhow::{Context, Result};
use serde::Deserialize;
use sqlx::postgres::PgConnectOptions;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize)]
pub struct Settings {
    pub server:   ServerSettings,
    pub core:     CoreSettings,
    pub database: DatabaseSettings,
    pub storage:  StorageSettings,
    pub chat:     ChatSettings,
    pub logging:  LoggingSettings,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerSettings {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CoreSettings {
    #[serde(default = "default_core_url")]
    pub url:             String,
    pub internal_secret: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseSettings {
    pub url:             Option<String>,
    pub host:            Option<String>,
    pub port:            Option<u16>,
    pub dbname:          Option<String>,
    pub username:        Option<String>,
    pub password:        Option<String>,
    #[serde(default = "default_max_connections")]
    pub max_connections: u32,
    #[serde(default = "default_min_connections")]
    pub min_connections: u32,
    #[serde(default = "default_connect_timeout")]
    #[serde(deserialize_with = "deserialize_duration")]
    pub connect_timeout: Duration,
    #[serde(default = "default_true")]
    pub run_migrations:  bool,
}

impl DatabaseSettings {
    pub fn connect_options(&self) -> Result<PgConnectOptions> {
        if let Some(url) = &self.url {
            url.parse::<PgConnectOptions>()
                .context("URL de base de données invalide")
        } else {
            let mut opts = PgConnectOptions::new()
                .host(self.host.as_deref().unwrap_or("127.0.0.1"))
                .port(self.port.unwrap_or(5432))
                .database(self.dbname.as_deref().unwrap_or("kubuno"))
                .username(self.username.as_deref().unwrap_or("kubuno"));
            if let Some(pass) = &self.password {
                opts = opts.password(pass);
            }
            Ok(opts)
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct StorageSettings {
    #[serde(default = "default_storage_local_path")]
    pub local_path:  String,
    #[serde(default = "default_storage_temp_path")]
    pub temp_path:   String,
    #[serde(default = "default_max_media_mb")]
    pub max_media_mb: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChatSettings {
    #[serde(default = "default_page_size")]
    pub messages_page_size:   u32,
    #[serde(default)]
    pub retention_days:       u32,
    #[serde(default = "default_opk_pool_min")]
    pub opk_pool_min:         u32,
    #[serde(default = "default_opk_pool_initial")]
    pub opk_pool_initial:     u32,
    #[serde(default = "default_presence_timeout")]
    pub presence_timeout_secs: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LoggingSettings {
    #[serde(default = "default_log_level")]
    pub level:  String,
    #[serde(default)]
    pub format: LogFormat,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum LogFormat {
    #[default]
    Pretty,
    Json,
}

impl Settings {
    pub fn load() -> Result<Self, config::ConfigError> {
        let mut builder = config::Config::builder()
            .set_default("server.host", "127.0.0.1")?
            .set_default("server.port", 3109)?
            .set_default("core.url", "http://127.0.0.1:8080")?
            .set_default("core.internal_secret", "")?
            .set_default("database.max_connections", 10)?
            .set_default("database.min_connections", 2)?
            .set_default("database.connect_timeout", 10)?
            .set_default("database.run_migrations", true)?
            .set_default("storage.local_path", "./data/chat/media")?
            .set_default("storage.temp_path", "./data/chat/temp")?
            .set_default("storage.max_media_mb", 50)?
            .set_default("chat.messages_page_size", 50)?
            .set_default("chat.retention_days", 0)?
            .set_default("chat.opk_pool_min", 20)?
            .set_default("chat.opk_pool_initial", 100)?
            .set_default("chat.presence_timeout_secs", 120)?
            .set_default("logging.level", "info")?
            .set_default("logging.format", "pretty")?
            .add_source(
                config::File::with_name("config")
                    .format(config::FileFormat::Toml)
                    .required(false),
            )
            .add_source(
                config::File::with_name("/etc/kubuno/modules/chat/config")
                    .format(config::FileFormat::Toml)
                    .required(false),
            )
            .add_source(
                config::Environment::with_prefix("KCHAT")
                    .separator("__")
                    .try_parsing(true),
            );
        // Variables injectées par le superviseur core — priorité maximale
        if let Ok(v) = std::env::var("KUBUNO_CORE_URL")        { builder = builder.set_override("core.url",             v).map_err(|e| config::ConfigError::Message(e.to_string()))?; }
        if let Ok(v) = std::env::var("KUBUNO_INTERNAL_SECRET") { builder = builder.set_override("core.internal_secret", v).map_err(|e| config::ConfigError::Message(e.to_string()))?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_HOST")         { builder = builder.set_override("database.host",     v).map_err(|e| config::ConfigError::Message(e.to_string()))?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_PORT")         { builder = builder.set_override("database.port",     v.parse::<i64>().unwrap_or(5432)).map_err(|e| config::ConfigError::Message(e.to_string()))?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_USER")         { builder = builder.set_override("database.username", v).map_err(|e| config::ConfigError::Message(e.to_string()))?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_PASSWORD")     { builder = builder.set_override("database.password", v).map_err(|e| config::ConfigError::Message(e.to_string()))?; }
        if let Ok(v) = std::env::var("KUBUNO_DB_NAME")         { builder = builder.set_override("database.dbname",   v).map_err(|e| config::ConfigError::Message(e.to_string()))?; }
        builder.build()?.try_deserialize()
    }
}

fn default_host()               -> String   { "127.0.0.1".into() }
fn default_port()               -> u16      { 3109 }
fn default_core_url()           -> String   { "http://127.0.0.1:8080".into() }
fn default_max_connections()    -> u32      { 10 }
fn default_min_connections()    -> u32      { 2 }
fn default_connect_timeout()    -> Duration { Duration::from_secs(10) }
fn default_true()               -> bool     { true }
fn default_storage_local_path() -> String   { "./data/chat/media".into() }
fn default_storage_temp_path()  -> String   { "./data/chat/temp".into() }
fn default_max_media_mb()       -> u64      { 50 }
fn default_page_size()          -> u32      { 50 }
fn default_opk_pool_min()       -> u32      { 20 }
fn default_opk_pool_initial()   -> u32      { 100 }
fn default_presence_timeout()   -> u64      { 120 }
fn default_log_level()          -> String   { "info".into() }

fn deserialize_duration<'de, D>(d: D) -> std::result::Result<Duration, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let secs = u64::deserialize(d)?;
    Ok(Duration::from_secs(secs))
}
