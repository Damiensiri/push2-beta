-- Rebuild only to extend the type CHECK; preserve every existing column and ID.
CREATE TABLE _planning_tasks_sequence AS SELECT seq FROM sqlite_sequence WHERE name='planning_tasks';
CREATE TABLE planning_tasks_next (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 week_start TEXT NOT NULL,
 horse_id INTEGER NOT NULL REFERENCES planning_horses(id) ON DELETE CASCADE,
 day_index INTEGER NOT NULL CHECK(day_index BETWEEN 0 AND 6),
 type TEXT NOT NULL CHECK(type IN ('paddock','travail','longe','repos','concours','cours','proprietaire','autre')),
 description TEXT NOT NULL DEFAULT '', paddock TEXT NOT NULL DEFAULT '',
 starts_at TEXT, ends_at TEXT,
 request_id INTEGER REFERENCES paddock_requests(id) ON DELETE SET NULL,
 position INTEGER NOT NULL DEFAULT 0, completed_at TEXT, completed_by TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 employee_id INTEGER REFERENCES staff_employees(id) ON DELETE SET NULL,
 source TEXT NOT NULL DEFAULT 'backstage' CHECK(source IN ('backstage','client','system')),
 created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 pwa_visible INTEGER NOT NULL DEFAULT 0 CHECK(pwa_visible IN (0,1))
);
INSERT INTO planning_tasks_next(id,week_start,horse_id,day_index,type,description,paddock,starts_at,ends_at,request_id,position,completed_at,completed_by,created_at,updated_at,employee_id,source,created_by_user_id)
 SELECT id,week_start,horse_id,day_index,type,description,paddock,starts_at,ends_at,request_id,position,completed_at,completed_by,created_at,updated_at,employee_id,source,created_by_user_id FROM planning_tasks;
DROP TABLE planning_tasks;
ALTER TABLE planning_tasks_next RENAME TO planning_tasks;
UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT MAX(seq) FROM _planning_tasks_sequence),0)) WHERE name='planning_tasks';
DROP TABLE _planning_tasks_sequence;
CREATE UNIQUE INDEX idx_planning_task_request ON planning_tasks(request_id) WHERE request_id IS NOT NULL;
CREATE INDEX idx_planning_tasks_week ON planning_tasks(week_start,day_index,horse_id,position);
CREATE INDEX idx_planning_tasks_employee ON planning_tasks(employee_id,week_start,day_index);
CREATE INDEX idx_planning_tasks_horse_week ON planning_tasks(horse_id,week_start,day_index,position,id);
CREATE INDEX idx_planning_tasks_author ON planning_tasks(created_by_user_id,source,id);
