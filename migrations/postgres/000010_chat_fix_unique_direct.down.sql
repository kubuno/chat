ALTER TABLE chat.conversations DROP CONSTRAINT IF EXISTS unique_direct;
ALTER TABLE chat.conversations ADD CONSTRAINT unique_direct UNIQUE NULLS NOT DISTINCT (user_a_id, user_b_id);
