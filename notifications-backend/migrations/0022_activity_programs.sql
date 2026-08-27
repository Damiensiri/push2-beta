CREATE TABLE IF NOT EXISTS activity_programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  starts_on TEXT NOT NULL,
  ends_on TEXT,
  enabled TEXT NOT NULL DEFAULT 'non' CHECK(enabled IN ('oui','non')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_programs_dates
  ON activity_programs(enabled, starts_on, ends_on);

CREATE TABLE IF NOT EXISTS activity_program_entries (
  program_id INTEGER NOT NULL,
  space_slug TEXT NOT NULL CHECK(space_slug IN ('carriere','manege')),
  day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 7),
  activity TEXT NOT NULL CHECK(activity IN ('liberte','longe')),
  enabled TEXT NOT NULL DEFAULT 'non' CHECK(enabled IN ('oui','non')),
  starts_at TEXT NOT NULL DEFAULT '',
  ends_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(program_id,space_slug,day,activity),
  FOREIGN KEY(program_id) REFERENCES activity_programs(id) ON DELETE CASCADE
);
