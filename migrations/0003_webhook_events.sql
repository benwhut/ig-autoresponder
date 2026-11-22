-- Diagnostic log of incoming webhook payloads and DM branch decisions.
-- Lets /admin/api/logs show the exact shape Meta sends, including DMs that
-- arrive under entry[].changes[] with field = "messages".

CREATE TABLE IF NOT EXISTS webhook_events (
  id           TEXT PRIMARY KEY,
  object       TEXT,
  entry_id     TEXT,
  kind         TEXT NOT NULL,
  sender_id    TEXT,
  recipient_id TEXT,
  text         TEXT,
  reason       TEXT,
  payload_json TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at
  ON webhook_events (created_at DESC);
