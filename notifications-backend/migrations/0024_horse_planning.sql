ALTER TABLE planning_tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'backstage'
  CHECK(source IN ('backstage','client','system'));

ALTER TABLE planning_tasks ADD COLUMN created_by_user_id INTEGER
  REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_planning_tasks_horse_week
  ON planning_tasks(horse_id,week_start,day_index,position,id);

CREATE INDEX idx_planning_tasks_author
  ON planning_tasks(created_by_user_id,source,id);
