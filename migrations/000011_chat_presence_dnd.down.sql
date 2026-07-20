-- Revert to the original status set; anything else falls back to 'away'.
UPDATE chat.presence SET status = 'away' WHERE status = 'dnd';

ALTER TABLE chat.presence DROP CONSTRAINT IF EXISTS presence_status_check;

ALTER TABLE chat.presence
    ADD CONSTRAINT presence_status_check
    CHECK (status IN ('online', 'away', 'offline'));
