DROP INDEX IF EXISTS chat.idx_chat_messages_pinned;
ALTER TABLE chat.messages DROP COLUMN IF EXISTS pinned_at;
ALTER TABLE chat.messages DROP COLUMN IF EXISTS is_pinned;
