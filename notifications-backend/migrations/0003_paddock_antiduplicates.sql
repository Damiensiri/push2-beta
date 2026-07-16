ALTER TABLE paddock_reservations ADD COLUMN lock_key TEXT;
UPDATE paddock_reservations SET lock_key='legacy-' || id WHERE lock_key IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_paddock_reservations_lock_key ON paddock_reservations(lock_key);

CREATE TABLE IF NOT EXISTS paddock_slot_locks (
  date TEXT NOT NULL,
  paddock TEXT NOT NULL,
  slot_minute INTEGER NOT NULL,
  reservation_key TEXT NOT NULL,
  PRIMARY KEY(date,paddock,slot_minute)
);
CREATE INDEX IF NOT EXISTS idx_paddock_slot_locks_reservation ON paddock_slot_locks(reservation_key);

WITH RECURSIVE occupied(id,date,paddock,slot_minute,end_minute,lock_key) AS (
  SELECT id,date,paddock,
    CAST(substr(time,1,2) AS INTEGER)*60+CAST(substr(time,4,2) AS INTEGER),
    CAST(substr(time,1,2) AS INTEGER)*60+CAST(substr(time,4,2) AS INTEGER)+duration,
    lock_key
  FROM paddock_reservations
  UNION ALL
  SELECT id,date,paddock,slot_minute+30,end_minute,lock_key
  FROM occupied WHERE slot_minute+30<end_minute
)
INSERT OR IGNORE INTO paddock_slot_locks(date,paddock,slot_minute,reservation_key)
SELECT date,paddock,slot_minute,lock_key FROM occupied;
