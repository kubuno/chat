-- Pinned messages: a message can be pinned within its conversation. Pinned
-- messages surface in a banner at the top of the conversation.
ALTER TABLE chat.messages ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chat.messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chat_messages_pinned
    ON chat.messages(conversation_id, pinned_at DESC) WHERE is_pinned;
