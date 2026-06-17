-- Fix: the original `unique_direct UNIQUE NULLS NOT DISTINCT (user_a_id, user_b_id)`
-- treats (NULL, NULL) as a single value, so only ONE group/channel/meeting (which
-- all leave user_a_id/user_b_id NULL) could ever exist — every additional one failed.
-- Default NULLS DISTINCT keeps direct conversations unique while allowing unlimited
-- group/channel/meeting rows.
ALTER TABLE chat.conversations DROP CONSTRAINT IF EXISTS unique_direct;
ALTER TABLE chat.conversations ADD CONSTRAINT unique_direct UNIQUE (user_a_id, user_b_id);
