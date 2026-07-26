ALTER TABLE planning_tasks ADD COLUMN employee_id INTEGER REFERENCES staff_employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_planning_tasks_employee
  ON planning_tasks(employee_id, week_start, day_index);
