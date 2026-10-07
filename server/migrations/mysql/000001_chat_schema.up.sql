-- Consolidated MySQL/MariaDB schema for the `chat` module: the final shape the
-- PostgreSQL migrations 000001..000020 reach, written once for an engine that
-- has no schemas (the `chat` database IS the namespace), no partial indexes, no
-- sequences and no triggers. The server never sees plaintext: every content
-- column is an opaque, client-encrypted blob.
--
-- Differences from the PostgreSQL spelling, all behaviour-preserving:
--   * UUID  -> BINARY(16), TIMESTAMPTZ -> DATETIME(6), JSONB -> JSON.
--   * ids and tokens are generated in Rust (no gen_random_uuid/uuid_generate_v4).
--   * partial indexes lose their WHERE (a plain index is a correct superset).
--   * updated_at is maintained with ON UPDATE; the module also sets it in Rust.

-- ── CONVERSATIONS ─────────────────────────────────────────────────────────────
CREATE TABLE chat.conversations (
    id          BINARY(16)  NOT NULL PRIMARY KEY,
    conv_type   VARCHAR(10) NOT NULL DEFAULT 'direct'
                    CHECK (conv_type IN ('direct', 'group', 'channel')),
    name        VARCHAR(255),
    description TEXT,
    avatar_path TEXT,
    user_a_id   BINARY(16),
    user_b_id   BINARY(16),
    created_by  BINARY(16),
    created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    is_meeting  BOOLEAN     NOT NULL DEFAULT FALSE,
    meeting_ended_at  DATETIME(6),
    meeting_settings  JSON   NOT NULL,
    provisional_until DATETIME(6),
    linked_ref  TEXT,
    -- Only direct conversations set (user_a_id, user_b_id); MySQL treats NULLs as
    -- distinct, so unlimited group/channel/meeting rows (both NULL) coexist.
    CONSTRAINT unique_direct UNIQUE (user_a_id, user_b_id)
);

CREATE INDEX idx_chat_conv_users        ON chat.conversations(user_a_id, user_b_id);
CREATE INDEX idx_chat_conv_updated      ON chat.conversations(updated_at);
CREATE INDEX idx_chat_conv_provisional  ON chat.conversations(provisional_until);
CREATE INDEX idx_chat_conv_linked_ref   ON chat.conversations(linked_ref(255));

-- ── MEMBERS ───────────────────────────────────────────────────────────────────
CREATE TABLE chat.conversation_members (
    conversation_id      BINARY(16)  NOT NULL,
    user_id              BINARY(16)  NOT NULL,
    role                 VARCHAR(10) NOT NULL DEFAULT 'member'
                             CHECK (role IN ('member', 'admin', 'owner')),
    last_read_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_read_message_id BINARY(16),
    muted_until          DATETIME(6),
    is_pinned            BOOLEAN     NOT NULL DEFAULT FALSE,
    joined_at            DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    left_at              DATETIME(6),
    is_archived          BOOLEAN     NOT NULL DEFAULT FALSE,
    is_favorite          BOOLEAN     NOT NULL DEFAULT FALSE,
    hidden_before        DATETIME(6),
    marked_unread        BOOLEAN     NOT NULL DEFAULT FALSE,
    PRIMARY KEY (conversation_id, user_id),
    FOREIGN KEY (conversation_id) REFERENCES chat.conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_members_user ON chat.conversation_members(user_id);

-- ── MESSAGES (fully client-encrypted content) ─────────────────────────────────
CREATE TABLE chat.messages (
    id              BINARY(16)  NOT NULL PRIMARY KEY,
    conversation_id BINARY(16)  NOT NULL,
    sender_id       BINARY(16)  NOT NULL,
    encrypted_data  MEDIUMTEXT  NOT NULL,
    message_type    VARCHAR(10) NOT NULL DEFAULT 'text'
                        CHECK (message_type IN ('text','image','video','audio','file','system','deleted','poll')),
    media_meta      JSON,
    reply_to_id     BINARY(16),
    status          VARCHAR(10) NOT NULL DEFAULT 'sent'
                        CHECK (status IN ('sent','delivered','read')),
    edited_at       DATETIME(6),
    deleted_at      DATETIME(6),
    nonce           VARCHAR(64) NOT NULL,
    sequence_num    BIGINT      NOT NULL DEFAULT 0,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    is_pinned       BOOLEAN     NOT NULL DEFAULT FALSE,
    pinned_at       DATETIME(6),
    scheduled_at    DATETIME(6),
    expires_at      DATETIME(6),
    UNIQUE (conversation_id, nonce),
    FOREIGN KEY (conversation_id) REFERENCES chat.conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (reply_to_id)     REFERENCES chat.messages(id)      ON DELETE SET NULL
);

CREATE INDEX idx_chat_messages_conv      ON chat.messages(conversation_id, created_at);
CREATE INDEX idx_chat_messages_sender    ON chat.messages(sender_id);
CREATE INDEX idx_chat_messages_reply     ON chat.messages(reply_to_id);
CREATE INDEX idx_chat_messages_pinned    ON chat.messages(conversation_id, pinned_at);
CREATE INDEX idx_chat_messages_scheduled ON chat.messages(scheduled_at);
CREATE INDEX idx_chat_messages_expires   ON chat.messages(expires_at);

-- ── REACTIONS ─────────────────────────────────────────────────────────────────
CREATE TABLE chat.message_reactions (
    message_id BINARY(16)  NOT NULL,
    user_id    BINARY(16)  NOT NULL,
    emoji      VARCHAR(10) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (message_id, user_id, emoji),
    FOREIGN KEY (message_id) REFERENCES chat.messages(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_reactions_msg ON chat.message_reactions(message_id);

-- ── READ RECEIPTS ─────────────────────────────────────────────────────────────
CREATE TABLE chat.read_receipts (
    message_id BINARY(16)  NOT NULL,
    user_id    BINARY(16)  NOT NULL,
    read_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (message_id, user_id),
    FOREIGN KEY (message_id) REFERENCES chat.messages(id) ON DELETE CASCADE
);

-- ── IDENTITY KEYS (public material only) ──────────────────────────────────────
CREATE TABLE chat.identity_keys (
    user_id          BINARY(16)  NOT NULL PRIMARY KEY,
    identity_key_pub TEXT        NOT NULL,
    fingerprint      VARCHAR(64) NOT NULL,
    created_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
);

-- ── SIGNED PREKEYS ────────────────────────────────────────────────────────────
CREATE TABLE chat.signed_prekeys (
    id          BINARY(16)  NOT NULL PRIMARY KEY,
    user_id     BINARY(16)  NOT NULL,
    key_id      INTEGER     NOT NULL,
    public_key  TEXT        NOT NULL,
    signature   TEXT        NOT NULL,
    expires_at  DATETIME(6) NOT NULL,
    created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE (user_id, key_id),
    FOREIGN KEY (user_id) REFERENCES chat.identity_keys(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_spk_user ON chat.signed_prekeys(user_id, expires_at);

-- ── ONE-TIME PREKEYS ──────────────────────────────────────────────────────────
CREATE TABLE chat.one_time_prekeys (
    id          BINARY(16)  NOT NULL PRIMARY KEY,
    user_id     BINARY(16)  NOT NULL,
    key_id      INTEGER     NOT NULL,
    public_key  TEXT        NOT NULL,
    claimed_at  DATETIME(6),
    claimed_by  BINARY(16),
    created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE (user_id, key_id),
    FOREIGN KEY (user_id) REFERENCES chat.identity_keys(user_id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_opk_user_free ON chat.one_time_prekeys(user_id);

-- ── DEVICES ───────────────────────────────────────────────────────────────────
CREATE TABLE chat.devices (
    id               BINARY(16)   NOT NULL PRIMARY KEY,
    user_id          BINARY(16)   NOT NULL,
    device_name      VARCHAR(255) NOT NULL,
    identity_key_pub TEXT         NOT NULL,
    push_token       TEXT,
    push_platform    VARCHAR(20) CHECK (push_platform IN ('webpush','apns','fcm')),
    last_seen_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    created_at       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

CREATE INDEX idx_chat_devices_user ON chat.devices(user_id);

-- ── PRESENCE ──────────────────────────────────────────────────────────────────
CREATE TABLE chat.presence (
    user_id       BINARY(16)   NOT NULL PRIMARY KEY,
    status        VARCHAR(10)  NOT NULL DEFAULT 'offline'
                      CHECK (status IN ('online','away','dnd','offline')),
    custom_status VARCHAR(100),
    manual_status VARCHAR(10)  CHECK (manual_status IS NULL OR manual_status IN ('away','dnd')),
    last_seen_at  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

-- ── GROUP SENDER KEYS ─────────────────────────────────────────────────────────
CREATE TABLE chat.group_sender_keys (
    id              BINARY(16)  NOT NULL PRIMARY KEY,
    conversation_id BINARY(16)  NOT NULL,
    sender_id       BINARY(16)  NOT NULL,
    recipient_id    BINARY(16)  NOT NULL,
    encrypted_key   TEXT        NOT NULL,
    key_iteration   INTEGER     NOT NULL DEFAULT 0,
    distributed_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE (conversation_id, sender_id, recipient_id, key_iteration),
    FOREIGN KEY (conversation_id) REFERENCES chat.conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_gsk_conv ON chat.group_sender_keys(conversation_id, recipient_id);

-- ── GROUP INVITES ─────────────────────────────────────────────────────────────
CREATE TABLE chat.group_invites (
    id              BINARY(16)  NOT NULL PRIMARY KEY,
    conversation_id BINARY(16)  NOT NULL,
    created_by      BINARY(16)  NOT NULL,
    token           VARCHAR(64) NOT NULL UNIQUE,
    max_uses        INTEGER,
    use_count       INTEGER     NOT NULL DEFAULT 0,
    expires_at      DATETIME(6),
    is_active       BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    FOREIGN KEY (conversation_id) REFERENCES chat.conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_invites_token ON chat.group_invites(token);

-- ── MEDIA FILES ───────────────────────────────────────────────────────────────
CREATE TABLE chat.media_files (
    id              BINARY(16)   NOT NULL PRIMARY KEY,
    uploader_id     BINARY(16)   NOT NULL,
    storage_path    TEXT         NOT NULL,
    original_name   VARCHAR(500) NOT NULL DEFAULT 'file',
    content_type    VARCHAR(255) NOT NULL DEFAULT 'application/octet-stream',
    encrypted_size  BIGINT,
    created_at      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
);

CREATE INDEX idx_chat_media_uploader ON chat.media_files(uploader_id);

-- ── POLL VOTES ────────────────────────────────────────────────────────────────
CREATE TABLE chat.poll_votes (
    message_id   BINARY(16)  NOT NULL,
    user_id      BINARY(16)  NOT NULL,
    option_index INTEGER     NOT NULL,
    voted_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (message_id, user_id),
    FOREIGN KEY (message_id) REFERENCES chat.messages(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_poll_votes_msg ON chat.poll_votes(message_id);

-- ── CALL RATINGS ──────────────────────────────────────────────────────────────
CREATE TABLE chat.call_ratings (
    id              BINARY(16)  NOT NULL PRIMARY KEY,
    conversation_id BINARY(16)  NOT NULL,
    user_id         BINARY(16)  NOT NULL,
    rating          SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    UNIQUE (conversation_id, user_id),
    FOREIGN KEY (conversation_id) REFERENCES chat.conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_call_ratings_conversation ON chat.call_ratings(conversation_id);

-- ── MEETING KNOCKS ────────────────────────────────────────────────────────────
CREATE TABLE chat.meeting_knocks (
    conversation_id BINARY(16)  NOT NULL,
    user_id         BINARY(16)  NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'admitted', 'denied')),
    requested_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    decided_at      DATETIME(6),
    denied_count    INTEGER     NOT NULL DEFAULT 0,
    PRIMARY KEY (conversation_id, user_id),
    FOREIGN KEY (conversation_id) REFERENCES chat.conversations(id) ON DELETE CASCADE
);

CREATE INDEX idx_chat_knocks_pending ON chat.meeting_knocks(conversation_id, requested_at);
