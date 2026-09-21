-- "Mark as unread" must show up even in a conversation where nobody else has
-- written (unread_count only counts other people's messages), so it needs its
-- own flag rather than a rewound last_read_at.
ALTER TABLE chat.conversation_members
    ADD COLUMN IF NOT EXISTS marked_unread BOOLEAN NOT NULL DEFAULT FALSE;
