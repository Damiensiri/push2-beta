CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  heure TEXT NOT NULL,
  categorie TEXT NOT NULL DEFAULT '',
  titre TEXT NOT NULL,
  message TEXT NOT NULL,
  epingle TEXT NOT NULL DEFAULT '',
  active TEXT NOT NULL DEFAULT 'oui',
  push_requested INTEGER NOT NULL DEFAULT 0,
  push_sent_at TEXT,
  onesignal_notification_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_alerts_active_date
  ON alerts(active, date DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_push_pending
  ON alerts(push_requested, push_sent_at);

