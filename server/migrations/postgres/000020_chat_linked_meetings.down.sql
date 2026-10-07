DROP INDEX IF EXISTS chat.idx_chat_conv_linked_ref;
ALTER TABLE chat.conversations DROP COLUMN IF EXISTS linked_ref;
