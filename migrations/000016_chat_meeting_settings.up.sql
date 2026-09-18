-- What a meeting's host decided BEFORE the meeting: who may share a screen,
-- who may write, whether anyone may walk in before the host does.
--
-- One JSONB column rather than a column per switch: these are the host's
-- preferences for one room, read and written as a whole by the panel that
-- edits them, and a new switch must not cost a migration. Absent keys mean
-- "the permissive default", so every room that predates this column behaves
-- exactly as it did.
ALTER TABLE chat.conversations
  ADD COLUMN IF NOT EXISTS meeting_settings JSONB NOT NULL DEFAULT '{}'::jsonb;
