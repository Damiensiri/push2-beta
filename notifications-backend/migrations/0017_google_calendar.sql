CREATE TABLE IF NOT EXISTS google_calendar_oauth_states (
  state_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_google_calendar_oauth_states_expiry
  ON google_calendar_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  calendar_name TEXT NOT NULL DEFAULT 'Agenda Google',
  encrypted_refresh_token TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
