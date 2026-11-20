CREATE TABLE IF NOT EXISTS library_refresh_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  history_after INTEGER NOT NULL DEFAULT 0,
  favorite_after INTEGER NOT NULL DEFAULT 0,
  history_end INTEGER NOT NULL DEFAULT 0,
  favorite_end INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO library_refresh_cursor(id) VALUES (1);
