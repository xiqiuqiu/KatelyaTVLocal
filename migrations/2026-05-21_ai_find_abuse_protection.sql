CREATE TABLE IF NOT EXISTS ai_find_usage_daily (
  scope TEXT NOT NULL,
  subject TEXT NOT NULL,
  day_key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (scope, subject, day_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_find_usage_daily_day_scope
ON ai_find_usage_daily(day_key, scope, count DESC);
