ALTER TABLE user_push_subscriptions ADD COLUMN installation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_push_subscriptions_installation
  ON user_push_subscriptions(user_id,installation_id)
  WHERE installation_id IS NOT NULL;
