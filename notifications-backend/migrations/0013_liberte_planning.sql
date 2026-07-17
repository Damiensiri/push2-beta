CREATE TABLE IF NOT EXISTS paddock_request_exceptions (
  date TEXT PRIMARY KEY,
  is_open INTEGER NOT NULL CHECK(is_open IN (0,1)),
  comment TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_paddock_request_exceptions_date
  ON paddock_request_exceptions(date);
