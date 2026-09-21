-- 000002_chat_keys.up.sql
-- Stockage des clés PUBLIQUES uniquement.
-- Les clés privées ne quittent JAMAIS le navigateur client.

-- ── IDENTITY KEYS ────────────────────────────────────────────────────────────
CREATE TABLE chat.identity_keys (
    user_id         UUID PRIMARY KEY,
    identity_key_pub TEXT NOT NULL,     -- base64url Ed25519
    fingerprint      VARCHAR(64) NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER identity_keys_updated_at
    BEFORE UPDATE ON chat.identity_keys
    FOR EACH ROW EXECUTE FUNCTION chat.set_updated_at();

-- ── SIGNED PREKEYS ────────────────────────────────────────────────────────────
CREATE TABLE chat.signed_prekeys (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES chat.identity_keys(user_id) ON DELETE CASCADE,
    key_id      INTEGER NOT NULL,
    public_key  TEXT NOT NULL,          -- base64url X25519
    signature   TEXT NOT NULL,          -- base64url Ed25519
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, key_id)
);

CREATE INDEX idx_chat_spk_user ON chat.signed_prekeys(user_id, expires_at DESC);

-- ── ONE-TIME PREKEYS ──────────────────────────────────────────────────────────
CREATE TABLE chat.one_time_prekeys (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES chat.identity_keys(user_id) ON DELETE CASCADE,
    key_id      INTEGER NOT NULL,
    public_key  TEXT NOT NULL,          -- base64url X25519
    claimed_at  TIMESTAMPTZ,
    claimed_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, key_id)
);

CREATE INDEX idx_chat_opk_user_free ON chat.one_time_prekeys(user_id)
    WHERE claimed_at IS NULL;

-- ── DEVICES ───────────────────────────────────────────────────────────────────
CREATE TABLE chat.devices (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id          UUID NOT NULL,
    device_name      VARCHAR(255) NOT NULL,
    identity_key_pub TEXT NOT NULL,
    push_token       TEXT,
    push_platform    VARCHAR(20) CHECK (push_platform IN ('webpush','apns','fcm')),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_devices_user ON chat.devices(user_id);

-- ── PRÉSENCE ──────────────────────────────────────────────────────────────────
CREATE TABLE chat.presence (
    user_id      UUID PRIMARY KEY,
    status       VARCHAR(10) NOT NULL DEFAULT 'offline'
                     CHECK (status IN ('online','away','offline')),
    custom_status VARCHAR(100),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
