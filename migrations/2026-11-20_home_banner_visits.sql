CREATE TABLE IF NOT EXISTS home_banner_visits (
  day_key TEXT NOT NULL,
  test_session INTEGER NOT NULL CHECK (test_session IN (0, 1)),
  owner TEXT NOT NULL,
  session_id TEXT NOT NULL,
  stage INTEGER NOT NULL CHECK (stage BETWEEN 1 AND 3),
  PRIMARY KEY (day_key, test_session, owner, session_id)
) WITHOUT ROWID;
