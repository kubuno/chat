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

#[derive(Debug, Clone, Copy)]
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
        }
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
