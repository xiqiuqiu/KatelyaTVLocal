CREATE TABLE IF NOT EXISTS playback_debug_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  source_key TEXT,
  playback_url TEXT,
  playback_domain TEXT,
  title TEXT,
  runtime TEXT,
  playlist_filter TEXT,
  segment_mode TEXT,
  recovery_profile TEXT,
  current_time REAL,
  duration REAL,
  ready_state INTEGER,
  network_state INTEGER,
  paused INTEGER,
  ended INTEGER,
  details_json TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_playback_debug_logs_created_at
  ON playback_debug_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_playback_debug_logs_session_id
  ON playback_debug_logs(session_id, created_at DESC);
