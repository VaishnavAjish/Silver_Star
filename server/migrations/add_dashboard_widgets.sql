-- Dashboard widget layout per user
-- The server auto-runs CREATE TABLE IF NOT EXISTS on startup,
-- so this file is provided for reference / manual execution.

CREATE TABLE IF NOT EXISTS user_dashboard_widgets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  widget_key TEXT    NOT NULL,
  position   INTEGER DEFAULT 0,
  is_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, widget_key)
);

CREATE INDEX IF NOT EXISTS idx_udw_user ON user_dashboard_widgets (user_id);
