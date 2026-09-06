-- Rebuild both linked tables atomically, preserving every record and notification.
DROP TRIGGER health_record_sending_guard;
DROP TRIGGER health_record_invalidate;
DROP TRIGGER health_owner_sending_guard;
DROP TRIGGER health_owner_invalidate;
DROP TRIGGER health_status_sending_guard;
DROP TRIGGER health_status_invalidate;
DROP TRIGGER health_user_sending_guard;
CREATE TABLE health_records_backup AS SELECT * FROM horse_health_records;
CREATE TABLE health_notifications_backup AS SELECT * FROM horse_notifications;
DROP TABLE horse_notifications;
DROP TABLE horse_health_records;
CREATE TABLE horse_health_records (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 horse_id INTEGER NOT NULL REFERENCES planning_horses(id) ON DELETE RESTRICT,
 type TEXT NOT NULL CHECK(type IN ('vaccine','deworming','farriery','dental','osteopathy')),
 label TEXT NOT NULL,
 series_key TEXT NOT NULL,
 performed_on TEXT NOT NULL,
 next_due_on TEXT,
 comment TEXT NOT NULL DEFAULT '',
 is_current INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0,1)),
 deleted_at TEXT,
 version INTEGER NOT NULL DEFAULT 1,
 creation_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_health_current ON horse_health_records(horse_id,type,series_key) WHERE is_current=1 AND deleted_at IS NULL;
CREATE INDEX idx_health_history ON horse_health_records(horse_id,id DESC);
CREATE INDEX idx_health_due ON horse_health_records(horse_id,next_due_on) WHERE is_current=1 AND deleted_at IS NULL;
CREATE TABLE horse_notifications (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 horse_id INTEGER NOT NULL REFERENCES planning_horses(id) ON DELETE RESTRICT,
 record_id INTEGER NOT NULL REFERENCES horse_health_records(id) ON DELETE RESTRICT,
 record_version INTEGER NOT NULL,
 user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 owner_since TEXT NOT NULL,
 offset_days INTEGER NOT NULL,
 scheduled_for TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','cancelled','failed','uncertain')),
 attempt_count INTEGER NOT NULL DEFAULT 0,
 claim_token TEXT,
 claimed_at TEXT,
 sent_at TEXT,
 last_error TEXT,
 UNIQUE(record_id,record_version,user_id,owner_since,offset_days)
);
CREATE INDEX idx_horse_notifications_pending ON horse_notifications(status,scheduled_for,id);
CREATE INDEX idx_horse_notifications_record ON horse_notifications(record_id,status);
CREATE INDEX idx_horse_notifications_owner ON horse_notifications(horse_id,user_id,status);
CREATE TRIGGER health_record_sending_guard BEFORE UPDATE ON horse_health_records BEGIN
 SELECT RAISE(ABORT,'HEALTH_SEND_IN_PROGRESS') WHERE EXISTS(SELECT 1 FROM horse_notifications WHERE record_id=OLD.id AND status='sending' AND claimed_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes'));
END;
CREATE TRIGGER health_record_invalidate AFTER UPDATE ON horse_health_records BEGIN
 UPDATE horse_notifications SET status='cancelled',claim_token=NULL WHERE record_id=OLD.id AND status IN ('pending','failed','sending','uncertain');
END;
CREATE TRIGGER health_owner_sending_guard BEFORE DELETE ON horse_owners BEGIN
 SELECT RAISE(ABORT,'HEALTH_SEND_IN_PROGRESS') WHERE EXISTS(SELECT 1 FROM horse_notifications WHERE horse_id=OLD.horse_id AND user_id=OLD.user_id AND status='sending' AND claimed_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes'));
END;
CREATE TRIGGER health_owner_invalidate AFTER DELETE ON horse_owners BEGIN
 UPDATE horse_notifications SET status='cancelled',claim_token=NULL WHERE horse_id=OLD.horse_id AND user_id=OLD.user_id AND status IN ('pending','failed','sending','uncertain');
END;
CREATE TRIGGER health_status_sending_guard BEFORE UPDATE OF status ON planning_horses WHEN OLD.status<>NEW.status BEGIN
 SELECT RAISE(ABORT,'HEALTH_SEND_IN_PROGRESS') WHERE EXISTS(SELECT 1 FROM horse_notifications WHERE horse_id=OLD.id AND status='sending' AND claimed_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes'));
END;
CREATE TRIGGER health_status_invalidate AFTER UPDATE OF status ON planning_horses WHEN NEW.status<>'active' BEGIN
 UPDATE horse_notifications SET status='cancelled',claim_token=NULL WHERE horse_id=NEW.id AND status IN ('pending','failed','sending','uncertain');
END;
CREATE TRIGGER health_user_sending_guard BEFORE UPDATE OF email,status ON users WHEN OLD.email<>NEW.email OR OLD.status<>NEW.status BEGIN
 SELECT RAISE(ABORT,'HEALTH_SEND_IN_PROGRESS') WHERE EXISTS(SELECT 1 FROM horse_notifications WHERE user_id=OLD.id AND status='sending' AND claimed_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-5 minutes'));
END;
INSERT INTO horse_health_records SELECT * FROM health_records_backup;
INSERT INTO horse_notifications SELECT * FROM health_notifications_backup;
DROP TABLE health_notifications_backup;
DROP TABLE health_records_backup;
