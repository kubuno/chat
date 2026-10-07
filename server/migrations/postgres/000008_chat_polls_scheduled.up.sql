-- Allow the 'poll' message type (poll question/options live encrypted in the
-- message envelope; only vote indices are stored server-side).
ALTER TABLE chat.messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE chat.messages ADD CONSTRAINT messages_message_type_check
    CHECK (message_type IN ('text','image','video','audio','file','system','deleted','poll'));

-- One vote per user per poll (single-choice). The server only sees the chosen
-- option index, never the plaintext option text.
CREATE TABLE IF NOT EXISTS chat.poll_votes (
    message_id   UUID NOT NULL REFERENCES chat.messages(id) ON DELETE CASCADE,
    user_id      UUID NOT NULL,
    option_index INTEGER NOT NULL,
    voted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_poll_votes_msg ON chat.poll_votes(message_id);

-- Scheduled delivery (future send) and ephemeral TTL (auto-delete).
ALTER TABLE chat.messages ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE chat.messages ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_chat_messages_scheduled ON chat.messages(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_messages_expires   ON chat.messages(expires_at)   WHERE expires_at IS NOT NULL;
