//! Instance-wide settings of the chat module, as the administrator left them in
//! the console.
//!
//! Declared by `module.toml`'s `[[settings]]`, stored in `core.settings`, and read
//! back through `/internal/modules/chat/settings`. Until this existed `retention_days`
//! was inert and `max_media_mb` read the STATIC deploy config, so admin edits did
//! nothing; both now flow through here.
//!
//! Chat is end-to-end encrypted: the server holds only ciphertext. These settings
//! act on the bytes and their age (a size cap, a retention window), on whether a
//! feature is available at all (attachments, link previews) and on who may talk
//! to whom (spaces, guests) — never on the content. The administrator can neither
//! read nor filter what is inside.

use serde_json::Value;

/// Who may create a space (group or channel). Direct conversations are never
/// gated — they are the baseline use of a messenger.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpaceCreation {
    Everyone,
    Admins,
}

/// Who may add members to an existing space.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpaceInvitePolicy {
    /// Any member of the space (historical behaviour).
    Members,
    /// Only the owner and the admins of that space.
    Managers,
}

#[derive(Debug, Clone)]
pub struct InstanceConfig {
    /// Days a message is kept before the retention worker tombstones its
    /// ciphertext. `0` = keep forever.
    pub retention_days: i32,
    /// Hours after which a message self-destructs when its author did not pick a
    /// delay. `0` = no automatic destruction. A shorter delay chosen by the user
    /// still wins.
    pub default_expiry_hours: i64,
    /// Whether attachments may be uploaded at all. The content is ciphertext, so
    /// this is an all-or-nothing switch, never a filter on file types.
    pub allow_file_sharing: bool,
    /// Maximum size, in megabytes, of an (encrypted) media attachment.
    pub max_media_mb: i64,
    /// Whether the server may fetch a URL on the client's behalf to build a link
    /// preview. Doing so takes the URL out of the encrypted envelope.
    pub allow_link_previews: bool,
    pub space_creation: SpaceCreation,
    pub space_invite_policy: SpaceInvitePolicy,
    /// Whether discoverable ("channel") spaces may be created, browsed and
    /// joined without an invitation.
    pub allow_public_spaces: bool,
    /// Whether guest accounts (the core's `guest` role — the local equivalent of
    /// an outside participant) may start a conversation or be added to a space.
    pub allow_guest_conversations: bool,
    /// STUN server URLs handed to every call (`stun:host:port`). Empty = none:
    /// calls then only work between hosts that can reach each other directly.
    pub ice_stun_urls: Vec<String>,
    /// TURN relay URLs (`turn:` / `turns:`). Empty = no relay, so a call
    /// between two different networks behind NAT fails.
    pub ice_turn_urls: Vec<String>,
    /// coturn's `static-auth-secret`. When set, every client gets its own
    /// short-lived TURN credential derived from it (the TURN REST API), and
    /// the secret itself never leaves the server.
    pub ice_turn_secret: String,
    /// Static TURN credential, used only when no shared secret is configured.
    pub ice_turn_username: String,
    pub ice_turn_credential: String,
}

impl Default for InstanceConfig {
    fn default() -> Self {
        Self {
            retention_days:       0,
            default_expiry_hours: 0,
            allow_file_sharing:   true,
            max_media_mb:         50,
            allow_link_previews:  true,
            space_creation:       SpaceCreation::Everyone,
            space_invite_policy:  SpaceInvitePolicy::Members,
            allow_public_spaces:  true,
            allow_guest_conversations: true,
            ice_stun_urls:        Vec::new(),
            ice_turn_urls:        Vec::new(),
            ice_turn_secret:      String::new(),
            ice_turn_username:    String::new(),
            ice_turn_credential:  String::new(),
        }
    }
}

impl InstanceConfig {
    /// Maps the core's `{key: value}` object onto the struct. Every read falls
    /// back to the compiled default; an out-of-range number is ignored. `0` is
    /// meaningful for retention (keep forever), so it is accepted there.
    pub fn from_settings(settings: &Value) -> Self {
        let d = Self::default();
        let int_in = |key: &str, min: i64, max: i64, fallback: i64| -> i64 {
            settings
                .get(key)
                .and_then(Value::as_i64)
                .filter(|n| (min..=max).contains(n))
                .unwrap_or(fallback)
        };
        let bool_at = |key: &str, fallback: bool| -> bool {
            settings.get(key).and_then(Value::as_bool).unwrap_or(fallback)
        };
        let str_at = |key: &str| -> Option<String> {
            settings.get(key).and_then(Value::as_str).map(str::to_owned)
        };
        Self {
            retention_days: int_in("retention_days", 0, 3650, d.retention_days as i64) as i32,
            default_expiry_hours: int_in("default_expiry_hours", 0, 8760, d.default_expiry_hours),
            allow_file_sharing: bool_at("allow_file_sharing", d.allow_file_sharing),
            // Ceiling of 100 MB on purpose: the router refuses any body past
            // that (`DefaultBodyLimit`), so a larger value here would promise an
            // upload the transport layer rejects first.
            max_media_mb:   int_in("max_media_mb", 1, 100, d.max_media_mb),
            allow_link_previews: bool_at("allow_link_previews", d.allow_link_previews),
            // An unknown enum member falls back to the permissive default rather
            // than locking everyone out on a typo.
            space_creation: match str_at("space_creation").as_deref() {
                Some("admins")   => SpaceCreation::Admins,
                Some("everyone") => SpaceCreation::Everyone,
                _                => d.space_creation,
            },
            space_invite_policy: match str_at("space_invite_policy").as_deref() {
                Some("managers") => SpaceInvitePolicy::Managers,
                Some("members")  => SpaceInvitePolicy::Members,
                _                => d.space_invite_policy,
            },
            allow_public_spaces: bool_at("allow_public_spaces", d.allow_public_spaces),
            allow_guest_conversations: bool_at(
                "allow_guest_conversations",
                d.allow_guest_conversations,
            ),
            ice_stun_urls: url_list(str_at("ice_stun_urls").as_deref(), &["stun:", "stuns:"]),
            ice_turn_urls: url_list(str_at("ice_turn_urls").as_deref(), &["turn:", "turns:"]),
            ice_turn_secret: str_at("ice_turn_secret").unwrap_or_default().trim().to_owned(),
            ice_turn_username: str_at("ice_turn_username").unwrap_or_default().trim().to_owned(),
            ice_turn_credential: str_at("ice_turn_credential").unwrap_or_default().trim().to_owned(),
        }
    }

    /// The ICE servers a client should hand to its `RTCPeerConnection`, as
    /// `[{urls, username?, credential?}]`. STUN entries are plain; the TURN
    /// entry carries either a credential minted for `user_id` (TURN REST API,
    /// valid `ttl_secs`) or the static one. Nothing is returned when the
    /// administrator configured nothing — the client then decides what to do.
    pub fn ice_servers(&self, user_id: uuid::Uuid, now_unix: i64, ttl_secs: i64) -> Vec<Value> {
        let mut out = Vec::new();
        if !self.ice_stun_urls.is_empty() {
            out.push(serde_json::json!({ "urls": self.ice_stun_urls }));
        }
        if !self.ice_turn_urls.is_empty() {
            if !self.ice_turn_secret.is_empty() {
                let (username, credential) = turn_rest_credential(&self.ice_turn_secret, user_id, now_unix + ttl_secs);
                out.push(serde_json::json!({
                    "urls": self.ice_turn_urls, "username": username, "credential": credential,
                }));
            } else if !self.ice_turn_username.is_empty() {
                out.push(serde_json::json!({
                    "urls": self.ice_turn_urls,
                    "username": self.ice_turn_username, "credential": self.ice_turn_credential,
                }));
            } else {
                out.push(serde_json::json!({ "urls": self.ice_turn_urls }));
            }
        }
        out
    }

    /// The flags the browser is allowed to know about, so the interface can hide
    /// what the server would refuse anyway. Enforcement stays server-side.
    pub fn public_flags(&self) -> Value {
        serde_json::json!({
            "allow_file_sharing":   self.allow_file_sharing,
            "max_media_mb":         self.max_media_mb,
            "allow_link_previews":  self.allow_link_previews,
            "allow_public_spaces":  self.allow_public_spaces,
            "allow_guest_conversations": self.allow_guest_conversations,
            "space_creation":       match self.space_creation {
                SpaceCreation::Admins   => "admins",
                SpaceCreation::Everyone => "everyone",
            },
            "space_invite_policy":  match self.space_invite_policy {
                SpaceInvitePolicy::Managers => "managers",
                SpaceInvitePolicy::Members  => "members",
            },
            "default_expiry_hours": self.default_expiry_hours,
        })
    }
}

/// Splits an administrator's comma/whitespace-separated list, keeping only the
/// entries that start with one of `schemes` — a typo never reaches a client.
fn url_list(raw: Option<&str>, schemes: &[&str]) -> Vec<String> {
    raw.unwrap_or("")
        .split([',', ' ', '\n', ';'])
        .map(str::trim)
        .filter(|u| !u.is_empty() && schemes.iter().any(|s| u.starts_with(s)))
        .map(str::to_owned)
        .collect()
}

/// TURN REST API credential (coturn `use-auth-secret`): the username is
/// `<expiry-unix>:<user>` and the password is `base64(HMAC-SHA1(secret, username))`.
fn turn_rest_credential(secret: &str, user_id: uuid::Uuid, expires_unix: i64) -> (String, String) {
    use base64::Engine;
    use hmac::{Hmac, Mac};
    let username = format!("{expires_unix}:{user_id}");
    // HMAC accepts a key of any length; the error branch is unreachable but
    // an empty credential is still safer than a panic on the request path.
    let Ok(mut mac) = Hmac::<sha1::Sha1>::new_from_slice(secret.as_bytes()) else {
        return (username, String::new());
    };
    mac.update(username.as_bytes());
    let credential = base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes());
    (username, credential)
}

/// Reads the instance settings from the core. Any failure yields `None`, so the
/// caller keeps the values it already had rather than reverting to defaults
/// because the core was briefly unreachable.
pub async fn fetch(http: &reqwest::Client, core_url: &str, secret: &str) -> Option<InstanceConfig> {
    let url = format!("{core_url}/internal/modules/chat/settings");
    let resp = http
        .get(&url)
        .header("X-Internal-Secret", secret)
        .send()
        .await
        .map_err(|e| tracing::warn!(error = %e, "Lecture des réglages d'instance chat"))
        .ok()?;

    if !resp.status().is_success() {
        tracing::warn!(status = %resp.status(), "Réglages d'instance chat refusés par le core");
        return None;
    }

    let body: Value = resp
        .json()
        .await
        .map_err(|e| tracing::warn!(error = %e, "Réglages d'instance chat : réponse illisible"))
        .ok()?;

    Some(InstanceConfig::from_settings(body.get("settings")?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn missing_keys_keep_the_compiled_defaults() {
        let c = InstanceConfig::from_settings(&json!({}));
        assert_eq!(c.retention_days, 0);
        assert_eq!(c.max_media_mb, 50);
        assert_eq!(c.default_expiry_hours, 0);
        assert!(c.allow_file_sharing);
        assert!(c.allow_link_previews);
        assert!(c.allow_public_spaces);
        assert!(c.allow_guest_conversations);
        assert_eq!(c.space_creation, SpaceCreation::Everyone);
        assert_eq!(c.space_invite_policy, SpaceInvitePolicy::Members);
    }

    #[test]
    fn values_are_read() {
        let c = InstanceConfig::from_settings(&json!({ "retention_days": 90, "max_media_mb": 25 }));
        assert_eq!(c.retention_days, 90);
        assert_eq!(c.max_media_mb, 25);
    }

    #[test]
    fn policies_are_read() {
        let c = InstanceConfig::from_settings(&json!({
            "default_expiry_hours": 24,
            "allow_file_sharing":   false,
            "allow_link_previews":  false,
            "allow_public_spaces":  false,
            "allow_guest_conversations": false,
            "space_creation":       "admins",
            "space_invite_policy":  "managers",
        }));
        assert_eq!(c.default_expiry_hours, 24);
        assert!(!c.allow_file_sharing);
        assert!(!c.allow_link_previews);
        assert!(!c.allow_public_spaces);
        assert!(!c.allow_guest_conversations);
        assert_eq!(c.space_creation, SpaceCreation::Admins);
        assert_eq!(c.space_invite_policy, SpaceInvitePolicy::Managers);
    }

    /// A value the module does not know must not lock the instance down.
    #[test]
    fn an_unknown_enum_member_falls_back_to_the_permissive_default() {
        let c = InstanceConfig::from_settings(&json!({
            "space_creation":      "moderators",
            "space_invite_policy": 42,
        }));
        assert_eq!(c.space_creation, SpaceCreation::Everyone);
        assert_eq!(c.space_invite_policy, SpaceInvitePolicy::Members);
    }
}
