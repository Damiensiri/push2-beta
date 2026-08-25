CREATE TABLE IF NOT EXISTS scheduled_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL UNIQUE,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','failed','cancelled')),
  claimed_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  delivery_key TEXT NOT NULL UNIQUE,
  onesignal_notification_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(alert_id) REFERENCES alerts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scheduled_notifications_due
  ON scheduled_notifications(status, scheduled_at);
