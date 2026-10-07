-- A meeting room is a group conversation that anyone holding its link can join
-- (open join), used for scheduled video meetings created from the calendar.
ALTER TABLE chat.conversations ADD COLUMN IF NOT EXISTS is_meeting BOOLEAN NOT NULL DEFAULT FALSE;
