CREATE TABLE IF NOT EXISTS paddock_push_reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reservation_id INTEGER NOT NULL,
  reminder_type TEXT NOT NULL CHECK(reminder_type IN ('start_1h','end_5m')),
  claimed_at TEXT NOT NULL,
  sent_at TEXT,
  onesignal_notification_id TEXT,
  UNIQUE(reservation_id,reminder_type),
  FOREIGN KEY(reservation_id) REFERENCES paddock_reservations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_paddock_push_reminders_sent
  ON paddock_push_reminders(sent_at,claimed_at);

CREATE TABLE IF NOT EXISTS user_push_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_push_subscriptions_user
  ON user_push_subscriptions(user_id);
