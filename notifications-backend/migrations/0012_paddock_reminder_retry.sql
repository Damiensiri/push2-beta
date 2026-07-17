ALTER TABLE paddock_push_reminders ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE paddock_push_reminders ADD COLUMN last_error TEXT;
ALTER TABLE paddock_push_reminders ADD COLUMN delivery_key TEXT;
