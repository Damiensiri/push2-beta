-- Run atomically (D1 migrations). D1 and desktop SQLite differ on whether
-- deferred ON DELETE CASCADE fires while replacing the parent, so retain
-- backups and restore missing rows idempotently on both runtimes.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE _horse_week_backup AS SELECT * FROM planning_week_horses;
CREATE TABLE _horse_task_backup AS SELECT * FROM planning_tasks;
CREATE TABLE _horse_sequence_backup AS SELECT seq FROM sqlite_sequence WHERE name='planning_horses';
CREATE TABLE planning_horses_next (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','departed','archived')),
  active INTEGER GENERATED ALWAYS AS (status='active') VIRTUAL,
  birth_date TEXT,
  public_notes TEXT NOT NULL DEFAULT '',
  admin_notes TEXT NOT NULL DEFAULT '',
  photo_key TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO planning_horses_next(id,name,status,created_at,updated_at)
  SELECT id,name,CASE WHEN active=1 THEN 'active' ELSE 'archived' END,created_at,updated_at FROM planning_horses;
DROP TABLE planning_horses;
ALTER TABLE planning_horses_next RENAME TO planning_horses;
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT MAX(seq) FROM _horse_sequence_backup),0)) WHERE name='planning_horses';
INSERT OR IGNORE INTO planning_week_horses SELECT * FROM _horse_week_backup;
INSERT OR IGNORE INTO planning_tasks SELECT * FROM _horse_task_backup;
DROP TABLE _horse_week_backup;
DROP TABLE _horse_task_backup;
DROP TABLE _horse_sequence_backup;
CREATE INDEX idx_horses_status_name ON planning_horses(status,name,id);
CREATE TABLE horse_owners (
  horse_id INTEGER NOT NULL REFERENCES planning_horses(id) ON DELETE RESTRICT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(horse_id,user_id)
);
CREATE INDEX idx_horse_owners_user ON horse_owners(user_id,horse_id);
PRAGMA defer_foreign_keys = OFF;
