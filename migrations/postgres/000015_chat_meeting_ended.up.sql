-- When a meeting was ended for everyone. A room that has been ended cannot be
-- rejoined; its host reopens it simply by starting it again.
ALTER TABLE chat.conversations
    ADD COLUMN IF NOT EXISTS meeting_ended_at TIMESTAMPTZ;
