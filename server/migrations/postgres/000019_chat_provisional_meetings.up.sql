-- A room that exists only because a form is being filled in.
--
-- Attaching a call to an event has to create the room BEFORE the event is
-- saved: the link is what gets saved, so it must exist first. But the form may
-- be abandoned, the call taken back off it, or the tab simply closed — and the
-- room would outlive the intention that made it, in everyone's meeting list,
-- for ever.
--
-- So a room can be born provisional: it belongs to a draft, not to anyone yet.
-- The instant is a deadline, not a flag, because the two things that end the
-- draft — saving it, throwing it away — are both messages the browser may never
-- send (a crash, a kill, a lost network). A deadline is the only form that
-- survives the browser going away mid-sentence: nothing has to be told.
--
-- NULL means a real room, which is what every room until now has been.
ALTER TABLE chat.conversations
  ADD COLUMN IF NOT EXISTS provisional_until TIMESTAMPTZ;

-- The sweep reads only the few rows that are still provisional.
CREATE INDEX IF NOT EXISTS idx_chat_conv_provisional
  ON chat.conversations(provisional_until)
  WHERE provisional_until IS NOT NULL;
