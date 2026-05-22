CREATE TABLE IF NOT EXISTS ai_find_saved_records (
  id TEXT NOT NULL,
  username TEXT NOT NULL,
  query TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL,
  opened_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (username, id)
);

CREATE INDEX IF NOT EXISTS idx_ai_find_saved_records_user_updated
ON ai_find_saved_records(username, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_find_saved_records_user_opened
ON ai_find_saved_records(username, last_opened_at DESC);
