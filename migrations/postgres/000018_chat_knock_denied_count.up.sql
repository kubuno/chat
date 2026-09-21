-- How many times this person has been refused.
--
-- Two refusals and they may no longer ask: a host who has said no twice has
-- said no, and a door that can be knocked on forever is a way to keep knocking
-- until someone gives in. The host can still put them in the room by hand,
-- which is the deliberate act the rule is asking for.
ALTER TABLE chat.meeting_knocks
  ADD COLUMN IF NOT EXISTS denied_count INTEGER NOT NULL DEFAULT 0;
