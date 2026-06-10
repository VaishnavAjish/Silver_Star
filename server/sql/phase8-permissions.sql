-- Phase 8: User Permissions & Preferences
-- Safe to run multiple times (IF NOT EXISTS)

CREATE TABLE IF NOT EXISTS user_permissions (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module         VARCHAR(50)  NOT NULL,
  permission_key VARCHAR(30)  NOT NULL,
  allowed        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  DEFAULT NOW(),
  UNIQUE(user_id, module, permission_key)
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pref_key    VARCHAR(50) NOT NULL,
  pref_value  TEXT,
  UNIQUE(user_id, pref_key)
);

CREATE INDEX IF NOT EXISTS idx_user_perms_user ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_prefs_user ON user_preferences(user_id);
