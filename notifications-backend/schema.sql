CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lock_key TEXT NOT NULL UNIQUE,
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

CREATE TABLE IF NOT EXISTS spaces (
  slug TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  manual_status TEXT NOT NULL DEFAULT 'ouvert',
  liberte TEXT NOT NULL DEFAULT '',
  longe TEXT NOT NULL DEFAULT '',
  info TEXT NOT NULL DEFAULT '',
  special_hours TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS space_schedules (
  space_slug TEXT NOT NULL,
  day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 7),
  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  PRIMARY KEY(space_slug,day),
  FOREIGN KEY(space_slug) REFERENCES spaces(slug) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS general_schedules (
  day INTEGER PRIMARY KEY CHECK(day BETWEEN 1 AND 7),
  opens_at TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_exceptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS home_alert (
  id INTEGER PRIMARY KEY CHECK(id=1),
  message TEXT NOT NULL DEFAULT '',
  urgent TEXT NOT NULL DEFAULT 'non',
  updated_at TEXT NOT NULL
);

-- Migration totale : les comptes sont créés depuis le Backstage bêta.
-- Aucun compte ni aucune session de production ne sont importés ici.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  card_number TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'client' CHECK(role IN ('client','staff','admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  approval_status TEXT NOT NULL DEFAULT 'approved' CHECK(approval_status IN ('pending','approved')),
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_status_name
  ON users(status,last_name,first_name);

CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user
  ON user_sessions(user_id,expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user
  ON password_reset_tokens(user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS paddock_reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lock_key TEXT NOT NULL UNIQUE,
  legacy_firebase_id TEXT UNIQUE,
  user_id INTEGER,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  paddock TEXT NOT NULL CHECK(paddock IN ('maison','grande','beudot')),
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  duration INTEGER NOT NULL CHECK(duration BETWEEN 1 AND 1440),
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_paddock_reservations_slot ON paddock_reservations(date,paddock,time);
CREATE INDEX IF NOT EXISTS idx_paddock_reservations_user ON paddock_reservations(user_id,date);

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

CREATE TABLE IF NOT EXISTS paddock_slot_locks (
  date TEXT NOT NULL,
  paddock TEXT NOT NULL,
  slot_minute INTEGER NOT NULL,
  reservation_key TEXT NOT NULL,
  PRIMARY KEY(date,paddock,slot_minute)
);
CREATE INDEX IF NOT EXISTS idx_paddock_slot_locks_reservation ON paddock_slot_locks(reservation_key);

CREATE TABLE IF NOT EXISTS paddock_hours (
  paddock TEXT PRIMARY KEY CHECK(paddock IN ('maison','grande','beudot')),
  schedule_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paddock_restrictions (
  date TEXT PRIMARY KEY,
  block_grande_90 INTEGER NOT NULL DEFAULT 0,
  block_beudot_90 INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paddock_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','refused','completed','cancelled')),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id,date),
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_paddock_requests_date_status ON paddock_requests(date,status);
CREATE INDEX IF NOT EXISTS idx_paddock_requests_user_date ON paddock_requests(user_id,date DESC);

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

CREATE TABLE IF NOT EXISTS catalog_products (
  id TEXT PRIMARY KEY, category TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  price_cents INTEGER NOT NULL, image_url TEXT NOT NULL DEFAULT '', badge TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT, public_id TEXT NOT NULL UNIQUE, user_id INTEGER NOT NULL,
  source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', comment TEXT NOT NULL DEFAULT '',
  total_cents INTEGER NOT NULL, billed INTEGER NOT NULL DEFAULT 0, billed_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL, product_id TEXT NOT NULL,
  name TEXT NOT NULL, unit_price_cents INTEGER NOT NULL, quantity INTEGER NOT NULL,
  line_total_cents INTEGER NOT NULL, FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);
