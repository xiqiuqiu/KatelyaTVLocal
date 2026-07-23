CREATE TABLE IF NOT EXISTS login_security_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_key TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_security_attempt_window
  ON login_security_events(attempt_key, created_at);
