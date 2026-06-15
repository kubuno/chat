ALTER TABLE chat.conversation_members
    ADD COLUMN IF NOT EXISTS hidden_before TIMESTAMPTZ;
