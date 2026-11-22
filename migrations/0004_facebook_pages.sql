-- Facebook Page support.
--
-- Instagram posts (reels, photos, carousels) are often cross-posted to a
-- Facebook Page. Facebook comments arrive as `object: "page"` with a
-- `feed` change, and the reply has to go through Messenger rather than an
-- Instagram DM. These columns let one Worker serve both platforms.
--
-- `rules.platform` defaults to 'both' so existing rules keep working for
-- Instagram and also start matching Facebook comments once a Page is
-- connected. New rules can be limited to a single platform.

ALTER TABLE rules ADD COLUMN platform TEXT NOT NULL DEFAULT 'both';
ALTER TABLE comment_executions ADD COLUMN platform TEXT NOT NULL DEFAULT 'instagram';
ALTER TABLE outbound_jobs ADD COLUMN platform TEXT NOT NULL DEFAULT 'instagram';
ALTER TABLE media_cache ADD COLUMN platform TEXT NOT NULL DEFAULT 'instagram';

CREATE INDEX IF NOT EXISTS idx_rules_platform
  ON rules (platform, enabled, priority DESC);

CREATE INDEX IF NOT EXISTS idx_media_cache_platform
  ON media_cache (platform, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_jobs_platform_status
  ON outbound_jobs (platform, status, run_after);
