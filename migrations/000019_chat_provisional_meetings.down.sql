DROP INDEX IF EXISTS chat.idx_chat_conv_provisional;
ALTER TABLE chat.conversations DROP COLUMN IF EXISTS provisional_until;
