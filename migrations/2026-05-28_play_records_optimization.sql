CREATE TABLE play_records_new (
  username TEXT NOT NULL,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  cover TEXT NOT NULL,
  year TEXT NOT NULL,
  index_episode INTEGER NOT NULL,
  total_episodes INTEGER NOT NULL,
  play_time INTEGER NOT NULL,
  total_time INTEGER NOT NULL,
  save_time INTEGER NOT NULL,
  search_title TEXT,
  PRIMARY KEY (username, key)
);

INSERT INTO play_records_new (
  username,
  key,
  title,
  source_name,
  cover,
  year,
  index_episode,
  total_episodes,
  play_time,
  total_time,
  save_time,
  search_title
)
SELECT
  username,
  key,
  title,
  source_name,
  cover,
  year,
  index_episode,
  total_episodes,
  play_time,
  total_time,
  save_time,
  search_title
FROM play_records;

DROP TABLE play_records;
ALTER TABLE play_records_new RENAME TO play_records;

CREATE INDEX IF NOT EXISTS idx_play_records_username_save_time
ON play_records(username, save_time DESC);
