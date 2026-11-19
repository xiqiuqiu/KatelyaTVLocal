-- Repair databases where the log table exists without the list-order index.
CREATE INDEX IF NOT EXISTS idx_playback_debug_logs_created_at
  ON playback_debug_logs(created_at DESC);
