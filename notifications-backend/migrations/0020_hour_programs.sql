CREATE TABLE IF NOT EXISTS hour_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('general','work','paddocks')),
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hour_programs_scope_dates
  ON hour_programs(scope, starts_on, ends_on);

CREATE TABLE IF NOT EXISTS hour_program_entries (
  program_id INTEGER NOT NULL,
  target_slug TEXT NOT NULL,
  day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 7),
  manual_status TEXT NOT NULL DEFAULT 'ouvert',
  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  special_hours TEXT NOT NULL DEFAULT '',
  info TEXT NOT NULL DEFAULT '',
  liberte TEXT NOT NULL DEFAULT '',
  longe TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(program_id,target_slug,day),
  FOREIGN KEY(program_id) REFERENCES hour_programs(id) ON DELETE CASCADE
);
