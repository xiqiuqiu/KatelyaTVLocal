-- Auth Audit Events (ADR 0008): append-only login/logout history for admin review.
-- Separate from login_security_events (rate-limit counters only).
CREATE TABLE IF NOT EXISTS auth_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  username TEXT NOT NULL,
  failure_reason TEXT,
  ip_redacted TEXT,
  device_class TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_events_created
  ON auth_audit_events(created_at);

CREATE INDEX IF NOT EXISTS idx_auth_audit_events_username_created
  ON auth_audit_events(username, created_at);

CREATE INDEX IF NOT EXISTS idx_auth_audit_events_type_created
  ON auth_audit_events(event_type, created_at);
