PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS paddock_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_firebase_id TEXT UNIQUE,
  user_id INTEGER,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  paddock TEXT NOT NULL CHECK(paddock IN ('maison','grande','beudot')),
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  duration INTEGER NOT NULL CHECK(duration BETWEEN 1 AND 1440),
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_paddock_reservations_slot ON paddock_reservations(date,paddock,time);
CREATE INDEX IF NOT EXISTS idx_paddock_reservations_user ON paddock_reservations(user_id,date);

CREATE TABLE IF NOT EXISTS paddock_hours (
  paddock TEXT PRIMARY KEY CHECK(paddock IN ('maison','grande','beudot')),
  schedule_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paddock_restrictions (
  date TEXT PRIMARY KEY,
  block_grande_90 INTEGER NOT NULL DEFAULT 0,
  block_beudot_90 INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
