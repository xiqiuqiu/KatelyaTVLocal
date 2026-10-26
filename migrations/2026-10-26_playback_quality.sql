CREATE TABLE IF NOT EXISTS playback_quality (
  owner TEXT NOT NULL,
  session_id TEXT NOT NULL,
  round_id INTEGER NOT NULL,
  root_round_id INTEGER NOT NULL,
  row_kind TEXT NOT NULL CHECK (row_kind IN ('round', 'source')),
  attempt_id INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'terminal')),
  outcome TEXT,
  content_key TEXT,
  episode_index INTEGER NOT NULL,
  source_key TEXT,
  platform TEXT NOT NULL,
  runtime TEXT NOT NULL,
  entry_kind TEXT NOT NULL,
  round_reason TEXT NOT NULL,
  source_reason TEXT,
  release_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  elapsed_ms REAL NOT NULL,
  active_wait_ms REAL NOT NULL,
  click_to_frame_ms REAL,
  page_to_frame_ms REAL,
  source_to_frame_ms REAL,
  frame_evidence TEXT,
  had_hidden INTEGER NOT NULL,
  autoplay_blocked INTEGER NOT NULL,
  prompt_choice TEXT,
  next_round_id INTEGER,
  day_key TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner, session_id, round_id, row_kind, attempt_id)
);

CREATE INDEX IF NOT EXISTS idx_playback_quality_day
ON playback_quality(day_key, release_id, row_kind);
CREATE INDEX IF NOT EXISTS idx_playback_quality_owner_day
ON playback_quality(owner, day_key);
CREATE INDEX IF NOT EXISTS idx_playback_quality_chain
ON playback_quality(owner, session_id, root_round_id, row_kind, round_id);
CREATE INDEX IF NOT EXISTS idx_playback_quality_retention
ON playback_quality(received_at);
