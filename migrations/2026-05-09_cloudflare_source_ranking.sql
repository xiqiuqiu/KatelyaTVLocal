CREATE TABLE IF NOT EXISTS source_probe_runs (
  id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS source_probe_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  source_name TEXT NOT NULL,
  title_sample TEXT,
  episode_url TEXT NOT NULL,
  playback_domain TEXT,
  probe_kind TEXT NOT NULL,
  probe_reason TEXT,
  upstream_status INTEGER,
  probe_time_ms INTEGER,
  resolution_label TEXT,
  first_segment_latency_ms INTEGER,
  first_segment_speed_kbps REAL,
  measured_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS source_rank_snapshots (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  playback_domain TEXT,
  window_key TEXT NOT NULL,
  health_score REAL NOT NULL,
  quality_score REAL NOT NULL,
  speed_score REAL NOT NULL,
  stability_score REAL NOT NULL,
  final_score REAL NOT NULL,
  success_rate REAL NOT NULL,
  direct_rate REAL NOT NULL,
  proxy_rate REAL NOT NULL,
  unavailable_rate REAL NOT NULL,
  sample_count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS playback_feedback_events (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  playback_domain TEXT,
  title TEXT,
  playback_mode TEXT NOT NULL,
  startup_success INTEGER NOT NULL,
  startup_time_ms INTEGER,
  switched_to_proxy INTEGER NOT NULL DEFAULT 0,
  browser_quality TEXT,
  browser_ping_ms INTEGER,
  browser_speed_label TEXT,
  session_error TEXT,
  recorded_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_probe_results_source_time
ON source_probe_results(source_key, measured_at DESC);

CREATE INDEX IF NOT EXISTS idx_rank_snapshots_source_window
ON source_rank_snapshots(source_key, window_key, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rank_snapshots_source_window_unique
ON source_rank_snapshots(source_key, window_key);

CREATE INDEX IF NOT EXISTS idx_rank_snapshots_window_score
ON source_rank_snapshots(window_key, final_score DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_feedback_source_time
ON playback_feedback_events(source_key, recorded_at DESC);
