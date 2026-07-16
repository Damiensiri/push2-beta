CREATE TABLE IF NOT EXISTS paddock_cards (
  user_id INTEGER PRIMARY KEY,
  total INTEGER NOT NULL CHECK(total BETWEEN 1 AND 999),
  remaining INTEGER NOT NULL CHECK(remaining BETWEEN 0 AND total),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS paddock_usages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  request_id INTEGER NOT NULL UNIQUE,
  usage_date TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('card','invoice')),
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(request_id) REFERENCES paddock_requests(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_paddock_usages_user_date ON paddock_usages(user_id,usage_date DESC,id DESC);
