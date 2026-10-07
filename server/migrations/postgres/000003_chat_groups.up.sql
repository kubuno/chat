-- 000003_chat_groups.up.sql

-- ── SENDER KEYS DE GROUPE ─────────────────────────────────────────────────────
-- Protocole Sender Key de Signal pour les groupes.
-- Chaque membre génère une Sender Key distribuée chiffrée pour chaque autre membre.
CREATE TABLE chat.group_sender_keys (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES chat.conversations(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL,
    recipient_id    UUID NOT NULL,
    encrypted_key   TEXT NOT NULL,      -- base64url
    key_iteration   INTEGER NOT NULL DEFAULT 0,
    distributed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (conversation_id, sender_id, recipient_id, key_iteration)
);

CREATE INDEX idx_chat_gsk_conv ON chat.group_sender_keys(conversation_id, recipient_id);

-- ── INVITATIONS DE GROUPE ────────────────────────────────────────────────────
CREATE TABLE chat.group_invites (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES chat.conversations(id) ON DELETE CASCADE,
    created_by      UUID NOT NULL,
    -- token sans pgcrypto : deux UUID concaténés sans tirets
    token           VARCHAR(64) UNIQUE NOT NULL DEFAULT
        replace(uuid_generate_v4()::text, '-', '') || replace(uuid_generate_v4()::text, '-', ''),
    max_uses        INTEGER,
    use_count       INTEGER NOT NULL DEFAULT 0,
    expires_at      TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_invites_token ON chat.group_invites(token)
    WHERE is_active = TRUE;
