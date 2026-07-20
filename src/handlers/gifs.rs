//! GIF search (GIPHY), proxied server-side.
//!
//! The API key is an instance setting (`chat.giphy_api_key`, admin-only): it
//! never reaches the browser. The client only ever talks to `/chat/gifs/*`.
//! `fetch` additionally streams the GIF bytes back so the client can encrypt
//! them and upload them like any other media — a sent GIF stays end-to-end
//! encrypted, and the recipient never hits GIPHY.

use std::time::Duration;

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::errors::{ChatError, ChatResult};
use crate::middleware::ChatUser;
use crate::state::AppState;

const GIPHY_API: &str = "https://api.giphy.com/v1/gifs";
/// Hosts the `fetch` proxy is allowed to reach (GIPHY CDN only).
const ALLOWED_HOSTS: [&str; 2] = ["media.giphy.com", "i.giphy.com"];
const MAX_GIF_BYTES: usize = 12 * 1024 * 1024;

#[derive(Deserialize)]
pub struct SearchQuery {
    #[serde(default)]
    pub q:      String,
    #[serde(default)]
    pub limit:  Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
    /// UI language, forwarded to GIPHY so results match the user's locale.
    #[serde(default)]
    pub lang:   Option<String>,
}

#[derive(Deserialize)]
pub struct FetchQuery {
    pub url: String,
}

/// Read the instance-wide GIPHY key seeded from `module.toml` into core.settings.
/// Empty (or absent) means the feature is disabled — the client hides the tab.
async fn giphy_key(st: &AppState) -> ChatResult<String> {
    let raw: Option<Value> = sqlx::query_scalar("SELECT value FROM core.settings WHERE key = 'chat.giphy_api_key'")
        .fetch_optional(&st.db)
        .await
        .map_err(|e| {
            tracing::error!(error = %e, "Lecture de chat.giphy_api_key");
            e
        })?;

    let key = raw
        .as_ref()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default();
    let key = key.trim().to_string();

    if key.is_empty() {
        return Err(ChatError::NotFound("GIF non configuré".into()));
    }
    Ok(key)
}

fn http_client() -> ChatResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("KubunoChat/0.1 (+gif-search)")
        .build()
        .map_err(|e| ChatError::Internal(anyhow::anyhow!(e)))
}

/// GET /gifs/status — whether GIF search is available on this instance.
pub async fn status(State(st): State<AppState>, _user: ChatUser) -> ChatResult<Json<Value>> {
    let enabled = giphy_key(&st).await.is_ok();
    Ok(Json(json!({ "enabled": enabled, "provider": "giphy" })))
}

/// GET /gifs/search?q=&limit=&offset=&lang= — search GIPHY (empty q → trending).
pub async fn search(
    State(st): State<AppState>,
    _user: ChatUser,
    Query(q): Query<SearchQuery>,
) -> ChatResult<Json<Value>> {
    let key = giphy_key(&st).await?;
    let limit = q.limit.unwrap_or(24).clamp(1, 50).to_string();
    let offset = q.offset.unwrap_or(0).min(4_000).to_string();
    let term = q.q.trim();
    let lang = q.lang.as_deref().unwrap_or("en");
    let lang = if lang.len() == 2 && lang.chars().all(|c| c.is_ascii_alphabetic()) { lang } else { "en" };

    let client = http_client()?;
    let req = if term.is_empty() {
        client
            .get(format!("{GIPHY_API}/trending"))
            .query(&[("api_key", key.as_str()), ("limit", &limit), ("offset", &offset), ("rating", "pg-13"), ("bundle", "messaging_non_clips")])
    } else {
        client
            .get(format!("{GIPHY_API}/search"))
            .query(&[("api_key", key.as_str()), ("q", term), ("limit", &limit), ("offset", &offset), ("rating", "pg-13"), ("lang", lang), ("bundle", "messaging_non_clips")])
    };

    let resp = req
        .send()
        .await
        .map_err(|e| ChatError::Validation(format!("GIPHY injoignable: {e}")))?;

    if !resp.status().is_success() {
        let code = resp.status();
        tracing::error!(status = %code, "Réponse GIPHY en erreur");
        return Err(ChatError::Validation("Recherche de GIF indisponible".into()));
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| ChatError::Validation(format!("Réponse GIPHY illisible: {e}")))?;

    let gifs: Vec<Value> = body
        .get("data")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(normalize_gif).collect())
        .unwrap_or_default();

    Ok(Json(json!({ "gifs": gifs })))
}

/// Keep only what the picker needs: a light preview and the full GIF to send.
fn normalize_gif(item: &Value) -> Option<Value> {
    let images = item.get("images")?;
    let pick = |name: &str| images.get(name).and_then(|i| i.get("url")).and_then(Value::as_str);
    let dim = |name: &str, field: &str| {
        images
            .get(name)
            .and_then(|i| i.get(field))
            .and_then(Value::as_str)
            .and_then(|s| s.parse::<u32>().ok())
    };

    let preview = pick("fixed_width_downsampled")
        .or_else(|| pick("fixed_width"))
        .or_else(|| pick("original"))?;
    let full = pick("downsized_medium")
        .or_else(|| pick("downsized"))
        .or_else(|| pick("fixed_width"))
        .or_else(|| pick("original"))?;

    Some(json!({
        "id":      item.get("id").and_then(Value::as_str).unwrap_or_default(),
        "title":   item.get("title").and_then(Value::as_str).unwrap_or_default(),
        "preview": preview,
        "url":     full,
        "width":   dim("fixed_width", "width").unwrap_or(200),
        "height":  dim("fixed_width", "height").unwrap_or(200),
    }))
}

/// GET /gifs/fetch?url=… — stream a GIPHY CDN asset back to the client, which
/// encrypts it and uploads it as a regular (E2E) media. Restricted to the GIPHY
/// CDN so this cannot be used as an open proxy.
pub async fn fetch(
    State(st): State<AppState>,
    _user: ChatUser,
    Query(q): Query<FetchQuery>,
) -> ChatResult<Response> {
    // Refuse to proxy anything unless GIF search is actually enabled here.
    giphy_key(&st).await?;

    let url = reqwest::Url::parse(q.url.trim())
        .map_err(|_| ChatError::Validation("URL invalide".into()))?;
    if url.scheme() != "https" || !ALLOWED_HOSTS.contains(&url.host_str().unwrap_or_default()) {
        return Err(ChatError::Forbidden);
    }

    let resp = http_client()?
        .get(url)
        .send()
        .await
        .map_err(|e| ChatError::Validation(format!("Téléchargement impossible: {e}")))?;

    if !resp.status().is_success() {
        return Err(ChatError::NotFound("GIF introuvable".into()));
    }

    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/gif")
        .to_string();
    if !content_type.starts_with("image/") {
        return Err(ChatError::Validation("Type de contenu inattendu".into()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| ChatError::Validation(format!("Lecture impossible: {e}")))?;
    if bytes.len() > MAX_GIF_BYTES {
        return Err(ChatError::Validation("GIF trop volumineux".into()));
    }

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        content_type.parse().unwrap_or_else(|_| "image/gif".parse().expect("static mime")),
    );
    Ok((StatusCode::OK, headers, Body::from(bytes)).into_response())
}
