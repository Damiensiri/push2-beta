CREATE TABLE IF NOT EXISTS planning_horses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS planning_week_horses (
  week_start TEXT NOT NULL,
  horse_id INTEGER NOT NULL REFERENCES planning_horses(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(week_start, horse_id)
);

CREATE TABLE IF NOT EXISTS planning_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start TEXT NOT NULL,
  horse_id INTEGER NOT NULL REFERENCES planning_horses(id) ON DELETE CASCADE,
  day_index INTEGER NOT NULL CHECK(day_index BETWEEN 0 AND 6),
  type TEXT NOT NULL CHECK(type IN ('paddock','travail','longe','repos','concours','proprietaire','autre')),
  description TEXT NOT NULL DEFAULT '',
  paddock TEXT NOT NULL DEFAULT '',
  starts_at TEXT,
  ends_at TEXT,
  request_id INTEGER REFERENCES paddock_requests(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  completed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_planning_task_request
  ON planning_tasks(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_planning_tasks_week
  ON planning_tasks(week_start, day_index, horse_id, position);

CREATE TABLE IF NOT EXISTS planning_kiosk_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
