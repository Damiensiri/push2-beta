-- Keep reservations as the only source of paddock events.
CREATE TABLE paddock_booking_horses (
  booking_id INTEGER NOT NULL REFERENCES paddock_reservations(id) ON DELETE CASCADE,
  horse_id INTEGER NOT NULL REFERENCES planning_horses(id) ON DELETE RESTRICT,
  PRIMARY KEY (booking_id, horse_id)
);
CREATE INDEX idx_paddock_booking_horses_horse ON paddock_booking_horses(horse_id, booking_id);
ALTER TABLE paddock_reservations ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
