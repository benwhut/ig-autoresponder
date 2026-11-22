-- Store the Instagram-scoped id that Meta returns as `recipient_id` when the
-- Step 1 private reply is sent. Inbound `entry[].messaging` events identify the
-- user via `messaging.sender.id`, which matches this value (it is not always
-- the same shape as the comment's `from.id`), so matching on it makes the
-- opt-in handshake reliable.

ALTER TABLE comment_executions ADD COLUMN recipient_igsid TEXT;

CREATE INDEX IF NOT EXISTS idx_comment_executions_recipient_state
  ON comment_executions (recipient_igsid, state);
