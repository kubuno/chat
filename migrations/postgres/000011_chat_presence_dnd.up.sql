-- Allow a "do not disturb" presence status (alongside online/away/offline).
ALTER TABLE chat.presence DROP CONSTRAINT IF EXISTS presence_status_check;

ALTER TABLE chat.presence
    ADD CONSTRAINT presence_status_check
    CHECK (status IN ('online', 'away', 'dnd', 'offline'));
