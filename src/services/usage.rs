//! Declaring to the core what **chat itself** stores, per account.
//!
//! ## The attribution rule
//!
//! Whoever physically holds the byte declares it, and only them. Chat holds all
//! of its own: message bodies and key material in its PostgreSQL schema, media
//! blobs through its `StorageBackend`. Nothing here is written into drive, so
//! nothing here is a delegation, and chat never emits `delegated`.
//!
//! ## Who a conversation's bytes belong to
//!
//! A message exists **once** and is read by several people. Attributing it to
//! every participant would multiply one byte by the size of the conversation —
//! the double counting this channel exists to prevent — so each object is
//! charged to the single account that brought it into existence:
//!
//! * `chat.messages.encrypted_data` → its `sender_id`;
//! * `chat.media_files.encrypted_size` → its `uploader_id`.
//!
//! Recipients are charged nothing. This is the same rule drive applies to a
//! shared file: the owner pays, the reader does not.
//!
//! ## What is billed and what is not
//!
//! The criterion is the platform's: **an account is billed for what it can free
//! itself**.
//!
//! * `content` — messages and media the account sent. It can delete them
//!   (`chat.messages.deleted_at` exists and the media row goes with it), so it
//!   pays for them.
//! * `system` — the Signal key material: identity key, signed and one-time
//!   prekeys, group sender keys, registered devices. The account never deposited
//!   these and cannot remove them without losing the ability to receive anything;
//!   they are what the module needs in order to work. Not billed, but declared,
//!   so an administrator looking at a large instance can see where the rows went.
//!
//! Chat is end-to-end encrypted, and this reporter changes nothing about that:
//! it reads sizes, never plaintext, and the figures it sends carry no name, no
//! recipient and no conversation.
//!
//! ## How bytes are measured
//!
//! `pg_column_size()` for everything stored in the database, never
//! `octet_length()`: these values are base64url text, TOASTed and compressed by
//! PostgreSQL, and the logical length would over-state what the instance holds by
//! the whole compression ratio. The media blobs are the exception — they sit on
//! the storage backend, not in a column, and `encrypted_size` is the figure the
//! upload path recorded.
//!
//! ## State, never deltas
//!
//! Each declaration carries chat's **current** figures for the accounts and
//! categories it names, so re-sending one changes nothing and a message lost in
//! flight costs one stale number until the next declaration repairs it. The core
//! keys rows on `(module_id, user_id, category)`; idempotence is structural.
//!
//! ## One rhythm, on purpose
//!
//! Like office and unlike drive, chat has no incremental `mark_dirty` path. A
//! message is a few hundred bytes and the hot path here is one write per
//! keystroke burst; threading a mark through it would cost more than the
//! freshness buys. A complete recount every six hours, plus one at startup, is
//! the whole design.

use std::collections::HashMap;
use std::time::Duration;

use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use crate::state::AppState;

/// How often the complete state is recounted and declared. Same period as the
/// other modules, so a console refresh does not show one of them systematically
/// staler than the rest.
const FULL_SYNC_INTERVAL: Duration = Duration::from_secs(6 * 3_600);

/// First retry delay when a declaration could not be delivered, doubling up to
/// [`FULL_SYNC_INTERVAL`].
///
/// The module starts before the core has necessarily finished accepting
/// registrations, so the very first declaration routinely fails. Without a
/// backoff it would be re-attempted six hours later and the breakdown would sit
/// empty for an afternoon after every reboot.
const FULL_RETRY_MIN: Duration = Duration::from_secs(15);

/// Matches the core's own per-request ceiling (`storage::usage::MAX_ENTRIES`).
/// A larger instance is declared in several calls.
const MAX_ENTRIES: usize = 5_000;

/// Identifier this module declares under. Only consulted by the core when the
/// caller could not be identified from its `X-Internal-Secret`: the core prefers
/// the secret's identity and answers 403 when the two disagree, so naming
/// ourselves in the body can never impersonate another module.
const MODULE_ID: &str = "chat";

// ── The closed category vocabulary, as chat uses it ──────────────────────────

/// What the account sent and can delete. Billed.
const CAT_CONTENT: &str = "content";
/// Signal key material and device registrations: what the module needs in order
/// to work, which the account did not deposit and cannot remove. Not billed.
const CAT_SYSTEM: &str = "system";

/// Every byte-bearing query chat runs, paired with the category it feeds.
///
/// Each statement must return exactly `(owner uuid, bytes bigint, objects bigint)`
/// and must only read chat's own schema. Keeping them in one table rather than
/// scattered through functions is what lets the tests below assert, mechanically,
/// that chat never charges a recipient and never reads another module's tables.
const OWNED_QUERIES: &[(&str, &str)] = &[
    // ── What the account sent ────────────────────────────────────────────────
    // Charged to `sender_id`, never to the conversation's members: the row
    // exists once. `media_meta` travels with the message and is counted with it.
    // Soft-deleted messages (`deleted_at IS NOT NULL`) keep only a tombstone
    // whose `encrypted_data` the delete path already emptied, so they cost what
    // they actually weigh rather than being excluded by a guess.
    (
        CAT_CONTENT,
        "SELECT sender_id,
                COALESCE(SUM(
                    pg_column_size(encrypted_data)
                  + COALESCE(pg_column_size(media_meta), 0)
                ), 0)::bigint,
                COUNT(*)::bigint
           FROM chat.messages
          GROUP BY sender_id",
    ),
    // Media blobs live on the storage backend, so the size comes from the column
    // the upload path wrote, not from `pg_column_size`. A row whose
    // `encrypted_size` was never filled counts as an object of unknown weight
    // rather than being dropped: the object is real and the console should see it.
    (
        CAT_CONTENT,
        "SELECT uploader_id,
                COALESCE(SUM(COALESCE(encrypted_size, 0)), 0)::bigint,
                COUNT(*)::bigint
           FROM chat.media_files
          GROUP BY uploader_id",
    ),
    // ── The machinery around it ──────────────────────────────────────────────
    (
        CAT_SYSTEM,
        "SELECT user_id,
                COALESCE(SUM(
                    pg_column_size(identity_key_pub) + pg_column_size(fingerprint)
                ), 0)::bigint,
                COUNT(*)::bigint
           FROM chat.identity_keys
          GROUP BY user_id",
    ),
    (
        CAT_SYSTEM,
        "SELECT user_id,
                COALESCE(SUM(
                    pg_column_size(public_key) + pg_column_size(signature)
                ), 0)::bigint,
                COUNT(*)::bigint
           FROM chat.signed_prekeys
          GROUP BY user_id",
    ),
    (
        CAT_SYSTEM,
        "SELECT user_id,
                COALESCE(SUM(pg_column_size(public_key)), 0)::bigint,
                COUNT(*)::bigint
           FROM chat.one_time_prekeys
          GROUP BY user_id",
    ),
    // A sender key is generated by `sender_id` for each recipient. It is the
    // sender's machinery, so the sender carries it — the same attribution as the
    // messages it protects, and the reason a group does not charge its members
    // for keys they never asked for.
    (
        CAT_SYSTEM,
        "SELECT sender_id,
                COALESCE(SUM(pg_column_size(encrypted_key)), 0)::bigint,
                COUNT(*)::bigint
           FROM chat.group_sender_keys
          GROUP BY sender_id",
    ),
    (
        CAT_SYSTEM,
        "SELECT user_id,
                COALESCE(SUM(
                    pg_column_size(device_name)
                  + pg_column_size(identity_key_pub)
                  + COALESCE(pg_column_size(push_token), 0)
                ), 0)::bigint,
                COUNT(*)::bigint
           FROM chat.devices
          GROUP BY user_id",
    ),
];

/// One `(account, category)` figure, as declared.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Entry {
    user_id: Uuid,
    category: &'static str,
    used_bytes: i64,
    object_count: i64,
}

/// Recounts everything chat holds.
///
/// A failing query is logged and skipped rather than aborting the whole
/// declaration: one broken table should cost its own line, not the entire
/// breakdown. The declaration is still marked `full`, which means a category that
/// failed here is *retired* by the core until the next sync repairs it — the
/// honest outcome, since publishing a stale figure as current state would be
/// worse than publishing none.
async fn collect(db: &PgPool) -> Vec<Entry> {
    // Several queries feed the same category (messages and media both feed
    // `content`), so figures are folded per `(user, category)` before being sent:
    // the core keys rows on that pair and would keep only the last one otherwise.
    let mut acc: HashMap<(Uuid, &'static str), (i64, i64)> = HashMap::new();

    for (category, sql) in OWNED_QUERIES {
        match sqlx::query_as::<_, (Uuid, i64, i64)>(sql).fetch_all(db).await {
            Ok(rows) => {
                for (user_id, bytes, objects) in rows {
                    let slot = acc.entry((user_id, *category)).or_insert((0, 0));
                    slot.0 += bytes;
                    slot.1 += objects;
                }
            }
            Err(e) => tracing::error!(
                error = %e,
                catégorie = *category,
                "Recomptage de consommation échoué pour une requête — catégorie incomplète"
            ),
        }
    }

    let mut entries: Vec<Entry> = acc
        .into_iter()
        .map(|((user_id, category), (used_bytes, object_count))| Entry {
            user_id,
            category,
            used_bytes,
            object_count,
        })
        .collect();

    // Stable order so consecutive declarations chunk identically — a moving
    // chunk boundary would make partial declarations retire different accounts
    // each time.
    entries.sort_by(|a, b| (a.user_id, a.category).cmp(&(b.user_id, b.category)));
    entries
}

/// How many calls a declaration of `n` entries takes. Zero entries still takes
/// one: an empty `full` declaration is a statement, not a no-op.
fn page_count(n: usize) -> usize {
    if n == 0 { 1 } else { n.div_ceil(MAX_ENTRIES) }
}

/// Whether `full` may actually be claimed on the wire.
///
/// A chunked declaration marked `full` would retire every entry outside whichever
/// chunk happened to be sent last. Beyond the ceiling the declaration is therefore
/// sent as partial: correct, but unable to retire a line until the instance drops
/// back under `MAX_ENTRIES`.
fn claims_full(full: bool, n: usize) -> bool {
    full && n <= MAX_ENTRIES
}

/// Sends one declaration to the core.
async fn send(
    http: &reqwest::Client,
    state: &AppState,
    entries: &[Entry],
    full: bool,
) -> Result<(), String> {
    let url = format!("{}/internal/storage/usage", state.settings.core.url);
    let usage: Vec<_> = entries
        .iter()
        .map(|e| {
            json!({
                "user_id":      e.user_id,
                "category":     e.category,
                "used_bytes":   e.used_bytes,
                "object_count": e.object_count,
            })
        })
        .collect();

    let resp = http
        .post(&url)
        .header(
            "X-Internal-Secret",
            state.settings.core.internal_secret.as_str(),
        )
        .json(&json!({ "module_id": MODULE_ID, "full": full, "usage": usage }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        return Ok(());
    }

    // The status alone does not say which of several validations refused the
    // declaration, and this runs unattended — a log line reading "HTTP 422" costs
    // an afternoon the next time the contract shifts.
    let status = resp.status();
    let detail = resp.text().await.unwrap_or_default();
    let detail: String = detail.chars().take(300).collect();
    Err(format!("HTTP {status} {detail}"))
}

/// Declares `entries` in as many calls as the core's ceiling requires.
///
/// Returns `true` when every call landed; the caller reschedules on that.
async fn declare(http: &reqwest::Client, state: &AppState, entries: Vec<Entry>, full: bool) -> bool {
    let full_on_wire = claims_full(full, entries.len());
    if full && !full_on_wire {
        tracing::warn!(
            entrées = entries.len(),
            envois = page_count(entries.len()),
            "Synchronisation complète découpée : déclarée en plusieurs envois partiels"
        );
    }

    // An empty full declaration is meaningful and must still be sent: it is how
    // chat says "I hold nothing for anybody", which the core has to be able to
    // tell apart from "chat has never declared".
    if entries.is_empty() {
        if !full_on_wire {
            // An empty *partial* declaration says nothing at all; sending it would
            // be a round-trip for no information.
            return true;
        }
        return match send(http, state, &[], true).await {
            Ok(()) => {
                tracing::debug!("Consommation déclarée : aucune entrée");
                true
            }
            Err(e) => {
                tracing::warn!(error = %e, "Déclaration de consommation échouée");
                false
            }
        };
    }

    let mut declared_bytes: i64 = 0;
    let mut sent = 0usize;
    let mut all_ok = true;
    for chunk in entries.chunks(MAX_ENTRIES) {
        match send(http, state, chunk, full_on_wire).await {
            Ok(()) => {
                declared_bytes += chunk.iter().map(|e| e.used_bytes).sum::<i64>();
                sent += chunk.len();
            }
            Err(e) => {
                all_ok = false;
                tracing::warn!(error = %e, entrées = chunk.len(), "Déclaration de consommation échouée");
            }
        }
    }

    if sent > 0 {
        tracing::debug!(
            entrées = sent,
            octets = declared_bytes,
            complète = full_on_wire,
            "Consommation déclarée au core"
        );
    }
    all_ok
}

/// The reporter task. Started once at bootstrap.
///
/// Its own `reqwest::Client` rather than one threaded through `AppState`: this is
/// the only outbound HTTP chat makes from a background task, and a client is a
/// connection pool, not a resource worth plumbing for a call every six hours.
pub async fn run_reporter(state: AppState) {
    let http = reqwest::Client::new();

    // Absolute deadline rather than an `interval`, so a failed sync can be pulled
    // forward without the retries drifting the normal period.
    let mut next_at = tokio::time::Instant::now(); // the first one is immediate
    let mut backoff = FULL_RETRY_MIN;

    tracing::info!("Rapporteur de consommation démarré (déclaration au core)");

    loop {
        tokio::time::sleep_until(next_at).await;

        let entries = collect(&state.db).await;
        let delivered = declare(&http, &state, entries, true).await;

        let now = tokio::time::Instant::now();
        if delivered {
            next_at = now + FULL_SYNC_INTERVAL;
            backoff = FULL_RETRY_MIN;
        } else {
            next_at = now + backoff;
            backoff = (backoff * 2).min(FULL_SYNC_INTERVAL);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rule this module exists to respect, checked mechanically.
    ///
    /// A message is stored once and read by many. Grouping by anything other than
    /// the account that created the row — a recipient, a conversation member —
    /// would charge one byte to several people. A reviewer adding a query here
    /// has to satisfy this test, not merely remember the rule.
    #[test]
    fn nothing_is_ever_charged_to_a_recipient() {
        for (_, sql) in OWNED_QUERIES {
            let lowered = sql.to_lowercase();
            assert!(
                !lowered.contains("recipient_id"),
                "une requête regroupe sur un destinataire — un octet serait facturé plusieurs fois : {sql}"
            );
            assert!(
                !lowered.contains("conversation_members"),
                "une requête passe par les membres d'une conversation — facturation multipliée : {sql}"
            );
        }
    }

    /// Chat writes nothing into drive, so it must never claim a delegation, and
    /// must never declare a category outside the two it actually uses.
    #[test]
    fn emitted_categories_are_the_expected_set() {
        use std::collections::BTreeSet;
        let cats: BTreeSet<&str> = OWNED_QUERIES.iter().map(|(c, _)| *c).collect();
        assert_eq!(
            cats,
            BTreeSet::from([CAT_CONTENT, CAT_SYSTEM]),
            "catégorie inattendue : chat ne détient que du contenu envoyé et sa machinerie de clés"
        );
        for (c, _) in OWNED_QUERIES {
            assert_ne!(
                *c, "delegated",
                "chat n'écrit rien dans drive : une délégation serait un mensonge"
            );
        }
    }

    /// A module reading another module's schema would be both an architecture
    /// violation and a double count waiting to happen.
    #[test]
    fn queries_only_read_the_chat_schema() {
        for (_, sql) in OWNED_QUERIES {
            let lowered = sql.to_lowercase();
            for foreign in ["drive.", "core.", "office.", "photos.", "media.", "mail."] {
                assert!(
                    !lowered.contains(foreign),
                    "la requête lit le schéma « {foreign} » : {sql}"
                );
            }
            assert!(
                lowered.contains("chat."),
                "la requête ne lit aucune table de chat : {sql}"
            );
        }
    }

    /// Every statement must yield the triple `collect` destructures, grouped by
    /// an account. A query returning a different shape fails at runtime, once, in
    /// production, six hours after anybody could have noticed.
    #[test]
    fn queries_group_by_an_owner() {
        for (_, sql) in OWNED_QUERIES {
            assert!(
                sql.to_lowercase().contains("group by"),
                "requête sans GROUP BY — une ligne par compte est le contrat : {sql}"
            );
        }
    }

    #[test]
    fn paging_respects_the_core_ceiling() {
        assert_eq!(page_count(0), 1, "une déclaration vide reste une déclaration");
        assert_eq!(page_count(1), 1);
        assert_eq!(page_count(MAX_ENTRIES), 1);
        assert_eq!(page_count(MAX_ENTRIES + 1), 2);
        assert_eq!(page_count(MAX_ENTRIES * 3), 3);
    }

    #[test]
    fn full_is_only_claimed_when_it_fits_in_one_call() {
        assert!(claims_full(true, MAX_ENTRIES));
        assert!(
            !claims_full(true, MAX_ENTRIES + 1),
            "une déclaration découpée ne peut pas se dire complète : elle retirerait les autres pages"
        );
        assert!(!claims_full(false, 1));
    }

    #[test]
    fn chunking_covers_every_entry_exactly_once() {
        let entries: Vec<Entry> = (0..MAX_ENTRIES * 2 + 7)
            .map(|i| Entry {
                user_id: Uuid::from_u128(i as u128),
                category: CAT_CONTENT,
                used_bytes: 1,
                object_count: 1,
            })
            .collect();
        let seen: usize = entries.chunks(MAX_ENTRIES).map(<[Entry]>::len).sum();
        assert_eq!(seen, entries.len());
        assert_eq!(entries.chunks(MAX_ENTRIES).count(), page_count(entries.len()));
    }
}
