-- M4: persist resume-route preferences on Watch Progress contentKey records.
ALTER TABLE play_records ADD COLUMN route_source TEXT;
ALTER TABLE play_records ADD COLUMN route_id TEXT;
