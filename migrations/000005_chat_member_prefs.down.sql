ALTER TABLE chat.conversation_members
    DROP COLUMN IF EXISTS is_archived,
    DROP COLUMN IF EXISTS is_favorite;
