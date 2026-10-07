-- A status picked by hand (Away / Do not disturb) must survive a WebSocket
-- reconnect, which otherwise forces `status = 'online'`.
ALTER TABLE chat.presence ADD COLUMN IF NOT EXISTS manual_status VARCHAR(10);

ALTER TABLE chat.presence DROP CONSTRAINT IF EXISTS presence_manual_status_check;
ALTER TABLE chat.presence ADD CONSTRAINT presence_manual_status_check
    CHECK (manual_status IS NULL OR manual_status IN ('away', 'dnd'));
