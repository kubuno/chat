//! Link preview (URL unfurling). The client detects a URL in a (decrypted)
//! message and asks the server to fetch its Open Graph / <title> metadata —
//! the server does the fetch so the browser avoids CORS and the page never
//! sees the user's IP.

use std::collections::HashMap;
use std::time::Duration;

use axum::{
    extract::{Query, State},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::errors::{ChatError, ChatResult};
use crate::middleware::ChatUser;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct UnfurlQuery {
    pub url: String,
}

/// GET /unfurl?url=… — fetch Open Graph metadata for a link preview.
pub async fn unfurl(
    State(_st): State<AppState>,
    _user: ChatUser,
    Query(q): Query<UnfurlQuery>,
) -> ChatResult<Json<Value>> {
    let parsed = reqwest::Url::parse(q.url.trim())
        .map_err(|_| ChatError::Validation("URL invalide".into()))?;

    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(ChatError::Validation("Schéma non supporté".into()));
    }
    // Basic SSRF guard: never fetch internal/loopback/private hosts.
    let host = parsed.host_str().unwrap_or("").to_lowercase();
    if is_private_host(&host) {
        return Err(ChatError::Forbidden);
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("KubunoChat/0.1 (+link-preview)")
        .build()
        .map_err(|e| ChatError::Internal(anyhow::anyhow!(e)))?;

    let resp = client
        .get(parsed.clone())
        .send()
        .await
        .map_err(|e| ChatError::Validation(format!("Récupération impossible: {e}")))?;

    // Only parse HTML documents.
    let is_html = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|c| c.contains("text/html") || c.contains("application/xhtml"))
        .unwrap_or(false);
    if !is_html {
        return Ok(Json(json!({ "url": parsed.to_string(), "title": null, "description": null, "image": null })));
    }

    // Read at most ~512 KB of the body (metadata lives in <head>).
    let bytes = resp.bytes().await.map_err(|e| ChatError::Validation(format!("Lecture: {e}")))?;
    let limit = bytes.len().min(512 * 1024);
    let html = String::from_utf8_lossy(&bytes[..limit]);

    let meta = extract_meta(&html);
    let title = meta.get("og:title").cloned().or_else(|| extract_title(&html));
    let description = meta.get("og:description").cloned().or_else(|| meta.get("description").cloned());
    let mut image = meta.get("og:image").cloned();
    let site = meta.get("og:site_name").cloned();

    // Resolve a relative og:image against the page URL.
    if let Some(img) = &image {
        if let Ok(abs) = parsed.join(img) {
            image = Some(abs.to_string());
        }
    }

    Ok(Json(json!({
        "url":         parsed.to_string(),
        "title":       title,
        "description": description,
        "image":       image,
        "site_name":   site,
    })))
}

/// Reject loopback / link-local / RFC 1918 hosts (coarse SSRF protection).
fn is_private_host(host: &str) -> bool {
    if host.is_empty() || host == "localhost" || host.ends_with(".local") || host.ends_with(".internal") {
        return true;
    }
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return match ip {
            std::net::IpAddr::V4(v4) => {
                v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.is_unspecified()
            }
            std::net::IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
        };
    }
    false
}

/// Extract `property`/`name` → `content` for every <meta> tag (attribute order
/// agnostic, no external HTML parser).
fn extract_meta(html: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let mut i = 0;
    while let Some(pos) = html[i..].find("<meta") {
        let start = i + pos;
        let end = html[start..].find('>').map(|e| start + e + 1).unwrap_or(html.len());
        let tag = &html[start..end];
        let key = attr(tag, "property").or_else(|| attr(tag, "name"));
        let content = attr(tag, "content");
        if let (Some(k), Some(c)) = (key, content) {
            map.entry(k.to_lowercase()).or_insert(c);
        }
        i = end;
        if i >= html.len() {
            break;
        }
    }
    map
}

/// Read an attribute value from a single tag (handles ' and ").
fn attr(tag: &str, name: &str) -> Option<String> {
    for quote in ['"', '\''] {
        let pat = format!(" {name}={quote}");
        if let Some(p) = tag.find(&pat) {
            let rest = &tag[p + pat.len()..];
            if let Some(e) = rest.find(quote) {
                return Some(html_decode(rest[..e].trim()));
            }
        }
    }
    None
}

fn extract_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title")?;
    let gt = lower[start..].find('>')? + start + 1;
    let end = lower[gt..].find("</title>")? + gt;
    let t = html_decode(html[gt..end].trim());
    if t.is_empty() { None } else { Some(t) }
}

fn html_decode(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&#x27;", "'")
        .replace("&apos;", "'")
        .replace("&nbsp;", " ")
}
