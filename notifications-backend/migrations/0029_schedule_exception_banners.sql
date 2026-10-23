ALTER TABLE schedule_exceptions ADD COLUMN end_date TEXT;
ALTER TABLE schedule_exceptions ADD COLUMN color TEXT NOT NULL DEFAULT 'orange' CHECK(color IN ('orange','red'));
