ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved'
  CHECK(approval_status IN ('pending','approved'));

CREATE INDEX IF NOT EXISTS idx_users_approval_status
  ON users(approval_status,created_at);
