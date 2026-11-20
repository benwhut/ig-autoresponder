-- Instagram Comment-to-DM Autoresponder - initial schema.
-- Safe to re-run: every object uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS system_config (
  key             TEXT PRIMARY KEY,
  value_encrypted TEXT NOT NULL,
  expires_at      TEXT,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media_cache (
  media_id      TEXT PRIMARY KEY,
  media_type    TEXT NOT NULL,
  caption       TEXT,
  permalink     TEXT,
  thumbnail_url TEXT,
  timestamp     TEXT NOT NULL,
  synced_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rules (
  id                     TEXT PRIMARY KEY,
  name                   TEXT NOT NULL,
  target_mode            TEXT NOT NULL DEFAULT 'specific_posts',
  media_ids_json         TEXT NOT NULL DEFAULT '[]',
  match_mode             TEXT NOT NULL DEFAULT 'any_keyword',
  keywords_json          TEXT NOT NULL DEFAULT '[]',
  delivery_mode          TEXT NOT NULL DEFAULT 'two_step_opt_in',
  initial_dm_text        TEXT NOT NULL,
  opt_in_keywords_json   TEXT NOT NULL DEFAULT '[]',
  followup_dm_text       TEXT NOT NULL DEFAULT '',
  public_replies_json    TEXT NOT NULL DEFAULT '[]',
  priority               INTEGER NOT NULL DEFAULT 0,
  enabled                INTEGER NOT NULL DEFAULT 1,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comment_executions (
  comment_id            TEXT PRIMARY KEY,
  media_id              TEXT NOT NULL,
  commenter_igsid       TEXT NOT NULL,
  commenter_username    TEXT,
  comment_text          TEXT NOT NULL,
  rule_id               TEXT,
  state                 TEXT NOT NULL,
  private_reply_sent_at TEXT,
  opt_in_completed_at   TEXT,
  public_reply_status   TEXT NOT NULL DEFAULT 'none',
  last_error            TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbound_jobs (
  id              TEXT PRIMARY KEY,
  job_type        TEXT NOT NULL,
  comment_id      TEXT NOT NULL,
  recipient_igsid TEXT,
  payload_json    TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued',
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 5,
  run_after       TEXT NOT NULL,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

-- Fast lookup when an inbound DM arrives for a commenter awaiting opt-in.
CREATE INDEX IF NOT EXISTS idx_comment_executions_commenter_state
  ON comment_executions (commenter_igsid, state);

-- Activity log ordering / filtering.
CREATE INDEX IF NOT EXISTS idx_comment_executions_created_at
  ON comment_executions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_comment_executions_media
  ON comment_executions (media_id);

-- Queue claim path.
CREATE INDEX IF NOT EXISTS idx_outbound_jobs_status_run_after
  ON outbound_jobs (status, run_after);

-- One job of each type per comment: hard idempotency even under webhook races.
CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_jobs_comment_type
  ON outbound_jobs (comment_id, job_type);

-- Rule resolution.
CREATE INDEX IF NOT EXISTS idx_rules_enabled_priority
  ON rules (enabled, priority DESC);
