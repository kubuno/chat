-- How people rated the audio and video quality of a call, asked once they
-- leave it. One row per person and per call, replaced if they rate again.
CREATE TABLE IF NOT EXISTS chat.call_ratings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID        NOT NULL REFERENCES chat.conversations(id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL,
    rating          SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_call_ratings_conversation ON chat.call_ratings(conversation_id);
