ALTER TABLE playback_quality ADD COLUMN test_session INTEGER NOT NULL DEFAULT 0 CHECK (test_session IN (0, 1));

CREATE TABLE IF NOT EXISTS playback_qoe (
  owner TEXT NOT NULL,
  session_id TEXT NOT NULL,
  visit INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  test_session INTEGER NOT NULL CHECK (test_session IN (0, 1)),
  uninterrupted INTEGER CHECK (uninterrupted IN (0, 1)),
  recovered INTEGER NOT NULL CHECK (recovered >= 0),
  failed INTEGER NOT NULL CHECK (failed >= 0),
  day_key TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (owner, session_id, visit)
);

CREATE INDEX IF NOT EXISTS idx_playback_qoe_owner_day ON playback_qoe(owner, day_key);
CREATE INDEX IF NOT EXISTS idx_playback_qoe_day ON playback_qoe(test_session, day_key);
CREATE INDEX IF NOT EXISTS idx_playback_qoe_retention ON playback_qoe(received_at);
