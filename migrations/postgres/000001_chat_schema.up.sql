-- 000001_chat_schema.up.sql
-- Le serveur ne voit jamais le contenu des messages en clair.
-- Tout le contenu stocké ici est opaque (chiffré côté client).

CREATE SCHEMA IF NOT EXISTS chat;

CREATE OR REPLACE FUNCTION chat.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── CONVERSATIONS ─────────────────────────────────────────────────────────────
CREATE TABLE chat.conversations (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conv_type   VARCHAR(10) NOT NULL DEFAULT 'direct'
                    CHECK (conv_type IN ('direct', 'group', 'channel')),
    name        VARCHAR(255),
    description TEXT,
    avatar_path TEXT,
    -- Pour les directs : les deux user IDs (pour retrouver une conv existante)
    user_a_id   UUID,
    user_b_id   UUID,
    created_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_direct UNIQUE NULLS NOT DISTINCT (user_a_id, user_b_id)
);

CREATE INDEX idx_chat_conv_users   ON chat.conversations(user_a_id, user_b_id)
    WHERE conv_type = 'direct';
CREATE INDEX idx_chat_conv_updated ON chat.conversations(updated_at DESC);

CREATE TRIGGER conversations_updated_at
    BEFORE UPDATE ON chat.conversations
    FOR EACH ROW EXECUTE FUNCTION chat.set_updated_at();

-- ── MEMBRES ───────────────────────────────────────────────────────────────────
CREATE TABLE chat.conversation_members (
    conversation_id  UUID NOT NULL REFERENCES chat.conversations(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL,
    role             VARCHAR(10) NOT NULL DEFAULT 'member'
                         CHECK (role IN ('member', 'admin', 'owner')),
    last_read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_read_message_id UUID,
    muted_until      TIMESTAMPTZ,
    is_pinned        BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at          TIMESTAMPTZ,
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX idx_chat_members_user ON chat.conversation_members(user_id)
    WHERE left_at IS NULL;

-- ── MESSAGES (contenu totalement chiffré côté client) ────────────────────────
CREATE TABLE chat.messages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES chat.conversations(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL,
    -- Données chiffrées opaques (base64url)
    encrypted_data  TEXT NOT NULL,
    -- Type de message (seule métadonnée visible du serveur)
    message_type    VARCHAR(10) NOT NULL DEFAULT 'text'
                        CHECK (message_type IN ('text','image','video','audio','file','system','deleted')),
    -- Pour les médias : métadonnées de l'asset chiffré
    media_meta      JSONB,
    reply_to_id     UUID REFERENCES chat.messages(id) ON DELETE SET NULL,
    status          VARCHAR(10) NOT NULL DEFAULT 'sent'
                        CHECK (status IN ('sent','delivered','read')),
    edited_at       TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    -- Anti-replay
    nonce           VARCHAR(64) NOT NULL,
    sequence_num    BIGINT NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (conversation_id, nonce)
);

CREATE INDEX idx_chat_messages_conv   ON chat.messages(conversation_id, created_at DESC);
CREATE INDEX idx_chat_messages_sender ON chat.messages(sender_id);
CREATE INDEX idx_chat_messages_reply  ON chat.messages(reply_to_id)
    WHERE reply_to_id IS NOT NULL;

-- ── RÉACTIONS ────────────────────────────────────────────────────────────────
CREATE TABLE chat.message_reactions (
    message_id UUID NOT NULL REFERENCES chat.messages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    emoji      VARCHAR(10) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX idx_chat_reactions_msg ON chat.message_reactions(message_id);

-- ── ACCUSÉS DE LECTURE ───────────────────────────────────────────────────────
CREATE TABLE chat.read_receipts (
    message_id UUID NOT NULL REFERENCES chat.messages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL,
    read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id)
);
