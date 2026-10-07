-- What owns this room's title, when something does.
--
-- A meeting attached to a calendar event (or, one day, to a task) is not a
-- separate thing that happens to share a name: it IS that event's call, and a
-- name typed in one place has to be the name read in the other. Renaming the
-- event and finding the old name in the meetings list is the kind of small lie
-- that makes people stop trusting either list.
--
-- An opaque `<module>:<id>` reference rather than a foreign key: chat has no
-- business knowing calendar's tables, and the two modules are installed
-- independently. It is the module named here that owns the title; this one
-- follows, and says so with a mark beside the name.
--
-- NULL = a meeting of its own, named by whoever created it.
ALTER TABLE chat.conversations
  ADD COLUMN IF NOT EXISTS linked_ref TEXT;

-- The rename arrives addressed by the reference, so that is what is looked up.
CREATE INDEX IF NOT EXISTS idx_chat_conv_linked_ref
  ON chat.conversations(linked_ref)
  WHERE linked_ref IS NOT NULL;
