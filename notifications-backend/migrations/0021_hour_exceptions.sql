CREATE TABLE IF NOT EXISTS hour_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('general','work','paddocks')),
  target_slug TEXT NOT NULL,
  manual_status TEXT NOT NULL DEFAULT 'ouvert',
  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(date,scope,target_slug)
);

CREATE INDEX IF NOT EXISTS idx_hour_exceptions_date_scope
  ON hour_exceptions(date,scope,target_slug);
