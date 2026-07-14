CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  heure TEXT NOT NULL,
  categorie TEXT NOT NULL DEFAULT '',
  titre TEXT NOT NULL,
  message TEXT NOT NULL,
  epingle TEXT NOT NULL DEFAULT '',
  active TEXT NOT NULL DEFAULT 'oui',
  push_requested INTEGER NOT NULL DEFAULT 0,
  push_sent_at TEXT,
  onesignal_notification_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_active_date
  ON alerts(active, date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_push_pending
  ON alerts(push_requested, push_sent_at);

CREATE TABLE IF NOT EXISTS spaces (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  manual_status TEXT NOT NULL DEFAULT 'ouvert',
  liberte TEXT NOT NULL DEFAULT '',
  longe TEXT NOT NULL DEFAULT '',
  info TEXT NOT NULL DEFAULT '',
  special_hours TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS space_schedules (
  space_slug TEXT NOT NULL,
  day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 7),
  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  PRIMARY KEY(space_slug,day),
  FOREIGN KEY(space_slug) REFERENCES spaces(slug) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS general_schedules (
  day INTEGER PRIMARY KEY CHECK(day BETWEEN 1 AND 7),
  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS home_alert (
  id INTEGER PRIMARY KEY CHECK(id=1),
  message TEXT NOT NULL DEFAULT '',
  urgent TEXT NOT NULL DEFAULT 'non',
  updated_at TEXT NOT NULL
);
