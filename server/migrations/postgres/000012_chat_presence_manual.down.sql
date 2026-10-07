ALTER TABLE chat.presence DROP CONSTRAINT IF EXISTS presence_manual_status_check;
ALTER TABLE chat.presence DROP COLUMN IF EXISTS manual_status;
