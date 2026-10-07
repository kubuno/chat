-- Consolidated SQLite schema for the `chat` module: the final shape the
-- PostgreSQL migrations 000001..000020 reach. `chat` is the ATTACHed database
-- name; tables are created there and referenced unqualified in foreign keys
-- (SQLite has no cross-schema references). UUID -> BLOB, TIMESTAMPTZ/JSONB ->
-- TEXT, BOOLEAN -> INTEGER. ids and tokens are generated in Rust.

-- ── CONVERSATIONS ─────────────────────────────────────────────────────────────
CREATE TABLE chat.conversations (
    id          BLOB    NOT NULL PRIMARY KEY,
    conv_type   TEXT    NOT NULL DEFAULT 'direct'
                    CHECK (conv_type IN ('direct', 'group', 'channel')),
    name        TEXT,
    description TEXT,
    avatar_path TEXT,
    user_a_id   BLOB,
    user_b_id   BLOB,
    created_by  BLOB,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    is_meeting  INTEGER NOT NULL DEFAULT 0,
    meeting_ended_at  TEXT,
    meeting_settings  TEXT NOT NULL DEFAULT '{}',
    provisional_until TEXT,
    linked_ref  TEXT,
    CONSTRAINT unique_direct UNIQUE (user_a_id, user_b_id)
);

CREATE INDEX chat.idx_chat_conv_users       ON conversations(user_a_id, user_b_id);
CREATE INDEX chat.idx_chat_conv_updated     ON conversations(updated_at);
CREATE INDEX chat.idx_chat_conv_provisional ON conversations(provisional_until) WHERE provisional_until IS NOT NULL;
CREATE INDEX chat.idx_chat_conv_linked_ref  ON conversations(linked_ref) WHERE linked_ref IS NOT NULL;

-- ── MEMBERS ───────────────────────────────────────────────────────────────────
CREATE TABLE chat.conversation_members (
    conversation_id      BLOB    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id              BLOB    NOT NULL,
    role                 TEXT    NOT NULL DEFAULT 'member'
                             CHECK (role IN ('member', 'admin', 'owner')),
    last_read_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    last_read_message_id BLOB,
    muted_until          TEXT,
    is_pinned            INTEGER NOT NULL DEFAULT 0,
    joined_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    left_at              TEXT,
    is_archived          INTEGER NOT NULL DEFAULT 0,
    is_favorite          INTEGER NOT NULL DEFAULT 0,
    hidden_before        TEXT,
    marked_unread        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX chat.idx_chat_members_user ON conversation_members(user_id) WHERE left_at IS NULL;

-- ── MESSAGES (fully client-encrypted content) ─────────────────────────────────
CREATE TABLE chat.messages (
    id              BLOB    NOT NULL PRIMARY KEY,
    conversation_id BLOB    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       BLOB    NOT NULL,
    encrypted_data  TEXT    NOT NULL,
    message_type    TEXT    NOT NULL DEFAULT 'text'
                        CHECK (message_type IN ('text','image','video','audio','file','system','deleted','poll')),
    media_meta      TEXT,
    reply_to_id     BLOB    REFERENCES messages(id) ON DELETE SET NULL,
    status          TEXT    NOT NULL DEFAULT 'sent'
                        CHECK (status IN ('sent','delivered','read')),
    edited_at       TEXT,
    deleted_at      TEXT,
    nonce           TEXT    NOT NULL,
    sequence_num    BIGINT  NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    is_pinned       INTEGER NOT NULL DEFAULT 0,
    pinned_at       TEXT,
    scheduled_at    TEXT,
    expires_at      TEXT,
    UNIQUE (conversation_id, nonce)
);

CREATE INDEX chat.idx_chat_messages_conv      ON messages(conversation_id, created_at);
CREATE INDEX chat.idx_chat_messages_sender    ON messages(sender_id);
CREATE INDEX chat.idx_chat_messages_reply     ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX chat.idx_chat_messages_pinned    ON messages(conversation_id, pinned_at) WHERE is_pinned;
CREATE INDEX chat.idx_chat_messages_scheduled ON messages(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX chat.idx_chat_messages_expires   ON messages(expires_at)   WHERE expires_at IS NOT NULL;

-- ── REACTIONS ─────────────────────────────────────────────────────────────────
CREATE TABLE chat.message_reactions (
    message_id BLOB    NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    BLOB    NOT NULL,
    emoji      TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX chat.idx_chat_reactions_msg ON message_reactions(message_id);

-- ── READ RECEIPTS ─────────────────────────────────────────────────────────────
CREATE TABLE chat.read_receipts (
    message_id BLOB    NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    BLOB    NOT NULL,
    read_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (message_id, user_id)
);

-- ── IDENTITY KEYS (public material only) ──────────────────────────────────────
CREATE TABLE chat.identity_keys (
    user_id          BLOB NOT NULL PRIMARY KEY,
    identity_key_pub TEXT NOT NULL,
    fingerprint      TEXT NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

-- ── SIGNED PREKEYS ────────────────────────────────────────────────────────────
CREATE TABLE chat.signed_prekeys (
    id          BLOB    NOT NULL PRIMARY KEY,
    user_id     BLOB    NOT NULL REFERENCES identity_keys(user_id) ON DELETE CASCADE,
    key_id      INTEGER NOT NULL,
    public_key  TEXT    NOT NULL,
    signature   TEXT    NOT NULL,
    expires_at  TEXT    NOT NULL,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    UNIQUE (user_id, key_id)
);

CREATE INDEX chat.idx_chat_spk_user ON signed_prekeys(user_id, expires_at);

-- ── ONE-TIME PREKEYS ──────────────────────────────────────────────────────────
CREATE TABLE chat.one_time_prekeys (
    id          BLOB    NOT NULL PRIMARY KEY,
    user_id     BLOB    NOT NULL REFERENCES identity_keys(user_id) ON DELETE CASCADE,
    key_id      INTEGER NOT NULL,
    public_key  TEXT    NOT NULL,
    claimed_at  TEXT,
    claimed_by  BLOB,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    UNIQUE (user_id, key_id)
);

CREATE INDEX chat.idx_chat_opk_user_free ON one_time_prekeys(user_id) WHERE claimed_at IS NULL;

-- ── DEVICES ───────────────────────────────────────────────────────────────────
CREATE TABLE chat.devices (
    id               BLOB NOT NULL PRIMARY KEY,
    user_id          BLOB NOT NULL,
    device_name      TEXT NOT NULL,
    identity_key_pub TEXT NOT NULL,
    push_token       TEXT,
    push_platform    TEXT CHECK (push_platform IN ('webpush','apns','fcm')),
    last_seen_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE INDEX chat.idx_chat_devices_user ON devices(user_id);

-- ── PRESENCE ──────────────────────────────────────────────────────────────────
CREATE TABLE chat.presence (
    user_id       BLOB NOT NULL PRIMARY KEY,
    status        TEXT NOT NULL DEFAULT 'offline'
                      CHECK (status IN ('online','away','dnd','offline')),
    custom_status TEXT,
    manual_status TEXT CHECK (manual_status IS NULL OR manual_status IN ('away','dnd')),
    last_seen_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

-- ── GROUP SENDER KEYS ─────────────────────────────────────────────────────────
CREATE TABLE chat.group_sender_keys (
    id              BLOB    NOT NULL PRIMARY KEY,
    conversation_id BLOB    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       BLOB    NOT NULL,
    recipient_id    BLOB    NOT NULL,
    encrypted_key   TEXT    NOT NULL,
    key_iteration   INTEGER NOT NULL DEFAULT 0,
    distributed_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    UNIQUE (conversation_id, sender_id, recipient_id, key_iteration)
);

CREATE INDEX chat.idx_chat_gsk_conv ON group_sender_keys(conversation_id, recipient_id);

-- ── GROUP INVITES ─────────────────────────────────────────────────────────────
CREATE TABLE chat.group_invites (
    id              BLOB    NOT NULL PRIMARY KEY,
    conversation_id BLOB    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    created_by      BLOB    NOT NULL,
    token           TEXT    NOT NULL UNIQUE,
    max_uses        INTEGER,
    use_count       INTEGER NOT NULL DEFAULT 0,
    expires_at      TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE INDEX chat.idx_chat_invites_token ON group_invites(token) WHERE is_active;

-- ── MEDIA FILES ───────────────────────────────────────────────────────────────
CREATE TABLE chat.media_files (
    id              BLOB   NOT NULL PRIMARY KEY,
    uploader_id     BLOB   NOT NULL,
    storage_path    TEXT   NOT NULL,
    original_name   TEXT   NOT NULL DEFAULT 'file',
    content_type    TEXT   NOT NULL DEFAULT 'application/octet-stream',
    encrypted_size  BIGINT,
    created_at      TEXT   NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now'))
);

CREATE INDEX chat.idx_chat_media_uploader ON media_files(uploader_id);

-- ── POLL VOTES ────────────────────────────────────────────────────────────────
CREATE TABLE chat.poll_votes (
    message_id   BLOB    NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id      BLOB    NOT NULL,
    option_index INTEGER NOT NULL,
    voted_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX chat.idx_chat_poll_votes_msg ON poll_votes(message_id);

-- ── CALL RATINGS ──────────────────────────────────────────────────────────────
CREATE TABLE chat.call_ratings (
    id              BLOB    NOT NULL PRIMARY KEY,
    conversation_id BLOB    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         BLOB    NOT NULL,
    rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    UNIQUE (conversation_id, user_id)
);

CREATE INDEX chat.idx_call_ratings_conversation ON call_ratings(conversation_id);

-- ── MEETING KNOCKS ────────────────────────────────────────────────────────────
CREATE TABLE chat.meeting_knocks (
    conversation_id BLOB    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         BLOB    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'admitted', 'denied')),
    requested_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
    decided_at      TEXT,
    denied_count    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX chat.idx_chat_knocks_pending ON meeting_knocks(conversation_id, requested_at) WHERE status = 'pending';
