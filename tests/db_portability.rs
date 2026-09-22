//! Portability proof for the `chat` module across the three kubuno-db engines.
//!
//! The SAME body (`exercise`) runs against SQLite (always, on a temp file),
//! PostgreSQL (when `KUBUNO_PG_TEST_URL` is set) and MySQL/MariaDB (when
//! `KUBUNO_MYSQL_TEST_URL` is set). It exercises chat's own schema only — never
//! the cross-schema `core.users` joins, which are PostgreSQL/MySQL-only by
//! design — covering the CRUD paths the port rewrote: conversations and members
//! (with the dialect upsert), messages (JSON media_meta, pin toggle,
//! soft-delete), reactions (INSERT-ignore idempotence), presence (upsert),
//! poll votes (upsert + counted), meeting knocks (upsert with a `{cur}`
//! expression), the one-time-prekey claim (`rows_affected == 1`), and the
//! integer-width decodes that break on a strict PostgreSQL.

use kubuno_chat::models::conversation::Conversation;
use kubuno_chat::models::message::Message;
use kubuno_chat::services::key_service;
use kubuno_db::dialect::{Assign, SqlType};
use kubuno_db::{new_id, params, DbPool, DbSettings};
use std::time::Duration;

const SCHEMA: &str = "chat";

fn migrator() -> kubuno_db::MigratorSet {
    kubuno_db::migrations!(
        "./migrations/postgres",
        "./migrations/mysql",
        "./migrations/sqlite",
    )
}

async fn reset(pool: &DbPool) {
    match pool.backend() {
        kubuno_db::Backend::Postgres => {
            pool.execute("DROP SCHEMA IF EXISTS chat CASCADE", params![]).await.unwrap();
            pool.execute("CREATE SCHEMA chat", params![]).await.unwrap();
        }
        kubuno_db::Backend::MySql => {
            pool.execute("SET FOREIGN_KEY_CHECKS = 0", params![]).await.unwrap();
            for t in [
                "meeting_knocks", "call_ratings", "poll_votes", "media_files", "group_invites",
                "group_sender_keys", "presence", "devices", "one_time_prekeys", "signed_prekeys",
                "identity_keys", "read_receipts", "message_reactions", "messages",
                "conversation_members", "conversations", "kubuno_event_outbox", "_sqlx_migrations",
            ] {
                pool.execute(&format!("DROP TABLE IF EXISTS chat.{t}"), params![]).await.unwrap();
            }
            pool.execute("SET FOREIGN_KEY_CHECKS = 1", params![]).await.unwrap();
        }
        kubuno_db::Backend::Sqlite => { /* fresh temp file per run */ }
    }
}

/// The full round-trip, identical on every engine.
async fn exercise(pool: &DbPool) {
    let backend = pool.backend();
    let now = chrono::Utc::now();
    let alice = new_id();
    let bob = new_id();

    // ── A conversation and its two members ───────────────────────────────────
    let conv_id = new_id();
    pool.execute(
        "INSERT INTO chat.conversations
         (id, conv_type, user_a_id, user_b_id, created_by, created_at, updated_at, meeting_settings)
         VALUES ($1, 'direct', $2, $3, $4, $5, $6, $7)",
        params![conv_id, alice, bob, alice, now, now, serde_json::json!({})],
    )
    .await
    .unwrap();

    let conv: Conversation = pool
        .fetch_one_as("SELECT * FROM chat.conversations WHERE id = $1", params![conv_id])
        .await
        .unwrap();
    assert_eq!(conv.conv_type, "direct");
    assert!(!conv.is_meeting);

    for uid in [alice, bob] {
        pool.execute(
            "INSERT INTO chat.conversation_members (conversation_id, user_id, role, last_read_at, joined_at)
             VALUES ($1, $2, 'member', $3, $4)",
            params![conv_id, uid, now, now],
        )
        .await
        .unwrap();
    }

    // The re-add upsert (`ON CONFLICT ... SET left_at = NULL`) must be idempotent.
    let upsert = backend.upsert(
        "chat.conversation_members",
        &["conversation_id", "user_id"],
        &[Assign::Expr { col: "left_at", expr: "NULL" }],
    );
    pool.execute(
        &format!(
            "INSERT INTO chat.conversation_members (conversation_id, user_id, role, last_read_at, joined_at)
             VALUES ($1, $2, 'member', $3, $4){upsert}"
        ),
        params![conv_id, alice, now, now],
    )
    .await
    .unwrap();

    // COUNT(*) decoded as i64 (a bare COUNT is a different width per engine).
    let member_count: i64 = pool
        .fetch_scalar(
            &format!(
                "SELECT {} FROM chat.conversation_members WHERE conversation_id = $1 AND left_at IS NULL",
                backend.count_bigint("*")
            ),
            params![conv_id],
        )
        .await
        .unwrap();
    assert_eq!(member_count, 2, "the upsert must not have duplicated a member");

    // ── A message with a JSON media_meta, pinned, then soft-deleted ──────────
    let msg_id = new_id();
    pool.execute(
        "INSERT INTO chat.messages
         (id, conversation_id, sender_id, encrypted_data, message_type, media_meta, nonce, created_at)
         VALUES ($1, $2, $3, $4, 'image', $5, $6, $7)",
        params![
            msg_id, conv_id, alice, "ciphertext",
            serde_json::json!({ "media_id": "abc", "w": 10 }),
            "nonce-1", now
        ],
    )
    .await
    .unwrap();

    let msg: Message = pool
        .fetch_one_as("SELECT * FROM chat.messages WHERE id = $1", params![msg_id])
        .await
        .unwrap();
    assert_eq!(msg.message_type, "image");
    assert_eq!(msg.sequence_num, 0);
    assert_eq!(
        msg.media_meta.as_ref().and_then(|m| m.get("media_id")).and_then(|v| v.as_str()),
        Some("abc")
    );

    // Pin toggle (`NOT is_pinned` + a `CASE WHEN is_pinned`), portable boolean.
    pool.execute(
        "UPDATE chat.messages
         SET pinned_at = CASE WHEN is_pinned THEN NULL ELSE $1 END, is_pinned = NOT is_pinned
         WHERE id = $2",
        params![now, msg_id],
    )
    .await
    .unwrap();
    let pinned: Message = pool
        .fetch_one_as("SELECT * FROM chat.messages WHERE id = $1", params![msg_id])
        .await
        .unwrap();
    assert!(pinned.is_pinned && pinned.pinned_at.is_some());

    // ── Reactions: INSERT-ignore is idempotent ───────────────────────────────
    let ignore = backend.on_conflict_do_nothing(&["message_id", "user_id", "emoji"]);
    for _ in 0..2 {
        pool.execute(
            &format!(
                "INSERT {}INTO chat.message_reactions (message_id, user_id, emoji, created_at)
                 VALUES ($1, $2, $3, $4){ignore}",
                backend.insert_ignore_prefix()
            ),
            params![msg_id, bob, "👍", now],
        )
        .await
        .unwrap();
    }
    let reactions: i64 = pool
        .fetch_scalar(
            &format!("SELECT {} FROM chat.message_reactions WHERE message_id = $1", backend.count_bigint("*")),
            params![msg_id],
        )
        .await
        .unwrap();
    assert_eq!(reactions, 1, "a duplicate reaction must be ignored, not counted twice");

    // ── Presence upsert ──────────────────────────────────────────────────────
    let pres_upsert = backend.upsert(
        "chat.presence",
        &["user_id"],
        &[Assign::Incoming("status"), Assign::Incoming("last_seen_at")],
    );
    for status in ["online", "away"] {
        pool.execute(
            &format!(
                "INSERT INTO chat.presence (user_id, status, last_seen_at) VALUES ($1, $2, $3){pres_upsert}"
            ),
            params![alice, status, now],
        )
        .await
        .unwrap();
    }
    let status: String = pool
        .fetch_scalar("SELECT status FROM chat.presence WHERE user_id = $1", params![alice])
        .await
        .unwrap();
    assert_eq!(status, "away");

    // ── Poll votes: upsert then change, counted per option ───────────────────
    let vote_upsert = backend.upsert(
        "chat.poll_votes",
        &["message_id", "user_id"],
        &[Assign::Incoming("option_index"), Assign::Incoming("voted_at")],
    );
    for idx in [0_i32, 2_i32] {
        pool.execute(
            &format!(
                "INSERT INTO chat.poll_votes (message_id, user_id, option_index, voted_at)
                 VALUES ($1, $2, $3, $4){vote_upsert}"
            ),
            params![msg_id, bob, idx, now],
        )
        .await
        .unwrap();
    }
    let chosen: i32 = pool
        .fetch_scalar(
            "SELECT option_index FROM chat.poll_votes WHERE message_id = $1 AND user_id = $2",
            params![msg_id, bob],
        )
        .await
        .unwrap();
    assert_eq!(chosen, 2, "the second vote must replace the first (one vote per user)");

    // ── Meeting knock: upsert with a `{cur}` status expression ───────────────
    let knock_upsert = backend.upsert(
        "chat.meeting_knocks",
        &["conversation_id", "user_id"],
        &[
            Assign::Expr { col: "status", expr: "CASE WHEN {cur} = 'admitted' THEN 'admitted' ELSE 'pending' END" },
            Assign::Incoming("requested_at"),
        ],
    );
    for _ in 0..2 {
        pool.execute(
            &format!(
                "INSERT INTO chat.meeting_knocks (conversation_id, user_id, status, requested_at)
                 VALUES ($1, $2, 'pending', $3){knock_upsert}"
            ),
            params![conv_id, bob, now],
        )
        .await
        .unwrap();
    }
    // denied_count is an INTEGER (int4 on PostgreSQL) — decoded as i32.
    let denied: i32 = pool
        .fetch_scalar(
            "SELECT denied_count FROM chat.meeting_knocks WHERE conversation_id = $1 AND user_id = $2",
            params![conv_id, bob],
        )
        .await
        .unwrap();
    assert_eq!(denied, 0);

    // ── The one-time-prekey claim (rows_affected == 1) via the real service ──
    pool.execute(
        "INSERT INTO chat.identity_keys (user_id, identity_key_pub, fingerprint, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)",
        params![alice, "ikpub", "fp", now, now],
    )
    .await
    .unwrap();
    pool.execute(
        "INSERT INTO chat.signed_prekeys (id, user_id, key_id, public_key, signature, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
        params![new_id(), alice, 1_i32, "spk", "sig", now + chrono::Duration::days(7), now],
    )
    .await
    .unwrap();
    for key_id in [10_i32, 11_i32] {
        pool.execute(
            "INSERT INTO chat.one_time_prekeys (id, user_id, key_id, public_key, created_at)
             VALUES ($1, $2, $3, $4, $5)",
            params![new_id(), alice, key_id, format!("opk{key_id}"), now],
        )
        .await
        .unwrap();
    }

    let bundle = key_service::get_prekey_bundle(pool, alice).await.unwrap();
    assert_eq!(bundle.signed_prekey_id, 1);
    assert!(bundle.one_time_prekey_id.is_some(), "a free OPK must be claimed");
    assert_eq!(bundle.opk_count, 1, "one of the two OPKs is now claimed");

    // The claimed OPK is really marked (claimed_at set), so the free count is 1.
    let free: i64 = pool
        .fetch_scalar(
            &format!(
                "SELECT {} FROM chat.one_time_prekeys WHERE user_id = $1 AND claimed_at IS NULL",
                backend.count_bigint("*")
            ),
            params![alice],
        )
        .await
        .unwrap();
    assert_eq!(free, 1);

    // ── Soft-delete the message (tombstone) ──────────────────────────────────
    pool.execute(
        "UPDATE chat.messages SET encrypted_data = '', message_type = 'deleted', deleted_at = $1 WHERE id = $2",
        params![now, msg_id],
    )
    .await
    .unwrap();
    let live: Option<i64> = pool
        .fetch_optional_scalar::<i64>(
            &format!(
                "SELECT {} FROM chat.messages WHERE id = $1 AND deleted_at IS NULL LIMIT 1",
                backend.cast("1", SqlType::BigInt)
            ),
            params![msg_id],
        )
        .await
        .unwrap();
    assert!(live.is_none(), "the message is now a tombstone");
}

fn sqlite_settings(dir: &std::path::Path) -> DbSettings {
    DbSettings {
        engine: "sqlite".into(),
        url: None,
        host: None,
        port: None,
        user: None,
        password: None,
        database: None,
        path: Some(dir.to_string_lossy().into_owned()),
        max_connections: 4,
        min_connections: 0,
        connect_timeout: Duration::from_secs(10),
        run_migrations: false,
        schema_prefix: None,
    }
}

fn url_settings(engine: &str, url: String) -> DbSettings {
    DbSettings {
        engine: engine.into(),
        url: Some(url),
        host: None,
        port: None,
        user: None,
        password: None,
        database: None,
        path: None,
        max_connections: 4,
        min_connections: 0,
        connect_timeout: Duration::from_secs(10),
        run_migrations: false,
    }
}

#[tokio::test]
async fn sqlite_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    let pool = kubuno_db::connect(&sqlite_settings(dir.path()), SCHEMA).await.unwrap();
    migrator().run(&pool, SCHEMA).await.unwrap();
    exercise(&pool).await;
}

#[tokio::test]
async fn postgres_round_trip() {
    let Ok(url) = std::env::var("KUBUNO_PG_TEST_URL") else {
        eprintln!("KUBUNO_PG_TEST_URL unset — skipping the PostgreSQL leg");
        return;
    };
    let pool = kubuno_db::connect(&url_settings("postgres", url), SCHEMA).await.unwrap();
    reset(&pool).await;
    migrator().run(&pool, SCHEMA).await.unwrap();
    exercise(&pool).await;
}

#[tokio::test]
async fn mysql_round_trip() {
    let Ok(url) = std::env::var("KUBUNO_MYSQL_TEST_URL") else {
        eprintln!("KUBUNO_MYSQL_TEST_URL unset — skipping the MySQL leg");
        return;
    };
    let pool = kubuno_db::connect(&url_settings("mysql", url), SCHEMA).await.unwrap();
    reset(&pool).await;
    migrator().run(&pool, SCHEMA).await.unwrap();
    exercise(&pool).await;
}
