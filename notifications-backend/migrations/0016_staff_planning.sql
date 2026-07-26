CREATE TABLE IF NOT EXISTS staff_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE,
  color TEXT NOT NULL DEFAULT '#F27D2C',
  active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_employees_name
  ON staff_employees(name);

CREATE TABLE IF NOT EXISTS staff_shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES staff_employees(id) ON DELETE CASCADE,
  work_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'work',
  morning_start TEXT,
  morning_end TEXT,
  afternoon_start TEXT,
  afternoon_end TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_staff_shifts_month
  ON staff_shifts(work_date, employee_id);

INSERT OR IGNORE INTO staff_employees(name,color,active,position,created_at,updated_at)
VALUES
  ('CARON Killian','#F27D2C',1,0,datetime('now'),datetime('now')),
  ('Salarié 2','#4C78C5',1,1,datetime('now'),datetime('now')),
  ('Salarié 3','#70AD47',1,2,datetime('now'),datetime('now')),
  ('Salarié 4','#A66DD4',1,3,datetime('now'),datetime('now'));

WITH imported(work_date,morning_start,morning_end,afternoon_start,afternoon_end) AS (
  VALUES
    ('2026-07-01','07:30','12:00','14:00','17:45'),
    ('2026-07-02','07:30','12:00','14:00','17:00'),
    ('2026-07-03','07:30','12:00',NULL,NULL),
    ('2026-07-04','07:00','12:30','15:00','16:45'),
    ('2026-07-05','08:00','10:00',NULL,NULL),
    ('2026-07-07','06:30','12:30','15:00','18:00'),
    ('2026-07-08','06:30','12:30',NULL,NULL),
    ('2026-07-09','07:30','12:30','15:00','18:00'),
    ('2026-07-10','07:30','12:30','14:30','17:00'),
    ('2026-07-11','07:00','12:00',NULL,NULL),
    ('2026-07-14','07:00','10:00',NULL,NULL),
    ('2026-07-15','07:00','11:30',NULL,NULL),
    ('2026-07-16','07:00','12:00',NULL,NULL),
    ('2026-07-17','07:30','12:00','13:30','17:15'),
    ('2026-07-18','07:30','11:00','13:30','17:00'),
    ('2026-07-20','07:00','10:30',NULL,NULL),
    ('2026-07-21',NULL,NULL,'14:00','18:00'),
    ('2026-07-22','07:30','12:00','15:00','18:00'),
    ('2026-07-23','07:30','12:00','15:00','18:00'),
    ('2026-07-24','07:30','12:00','14:30','17:30'),
    ('2026-07-25','07:00','12:00',NULL,NULL),
    ('2026-07-28','07:30','12:00','14:00','17:30'),
    ('2026-07-29','07:30','12:00','14:00','18:00'),
    ('2026-07-30','07:30','12:00','14:00','17:30'),
    ('2026-07-31','07:30','12:00',NULL,NULL),
    ('2026-08-01','07:30','11:00',NULL,NULL),
    ('2026-08-02','08:00','10:30',NULL,NULL)
)
INSERT OR IGNORE INTO staff_shifts(
  employee_id,work_date,status,morning_start,morning_end,afternoon_start,afternoon_end,note,created_at,updated_at
)
SELECT staff_employees.id,work_date,'work',morning_start,morning_end,afternoon_start,afternoon_end,'',datetime('now'),datetime('now')
FROM staff_employees
JOIN imported
WHERE staff_employees.name='CARON Killian';
