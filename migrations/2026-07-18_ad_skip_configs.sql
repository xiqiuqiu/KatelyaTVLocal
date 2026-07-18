-- Ad Skip Window persistence (ADR 0004 / #38)
-- Shared within one deployment; keyed by (source, id, episodeIndex).

CREATE TABLE IF NOT EXISTS ad_skip_configs (
  key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  video_id TEXT NOT NULL,
  episode_index INTEGER NOT NULL,
  windows TEXT NOT NULL,
  updated_time INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ad_skip_configs_source_video_episode
  ON ad_skip_configs(source, video_id, episode_index);

CREATE INDEX IF NOT EXISTS idx_ad_skip_configs_updated_time
  ON ad_skip_configs(updated_time DESC);
