DROP INDEX IF EXISTS chat.idx_chat_messages_expires;
DROP INDEX IF EXISTS chat.idx_chat_messages_scheduled;
ALTER TABLE chat.messages DROP COLUMN IF EXISTS expires_at;
ALTER TABLE chat.messages DROP COLUMN IF EXISTS scheduled_at;
DROP TABLE IF EXISTS chat.poll_votes;
ALTER TABLE chat.messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE chat.messages ADD CONSTRAINT messages_message_type_check
    CHECK (message_type IN ('text','image','video','audio','file','system','deleted'));
