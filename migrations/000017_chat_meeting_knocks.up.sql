-- Someone holding the link of a restricted meeting, asking to be let in.
--
-- A row per person per meeting, not per attempt: asking twice is asking once,
-- and the host must not be shown the same person twice. The status is what the
-- host decided, so a person who was let in stays let in (their tab may have
-- reloaded), and a person who was refused does not queue again on every
-- reload — they ask again explicitly.
CREATE TABLE IF NOT EXISTS chat.meeting_knocks (
    conversation_id UUID        NOT NULL REFERENCES chat.conversations(id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'admitted', 'denied')),
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at      TIMESTAMPTZ,
    PRIMARY KEY (conversation_id, user_id)
);

-- The host's list is "who is waiting, oldest first", and it is polled while a
-- meeting is open: it deserves its own index rather than a scan per poll.
CREATE INDEX IF NOT EXISTS idx_chat_knocks_pending
    ON chat.meeting_knocks (conversation_id, requested_at)
    WHERE status = 'pending';
