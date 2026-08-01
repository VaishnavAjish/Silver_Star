-- ============================================================
-- SILVERSTAR GROW — User Permission Overrides System
-- Phase 86: Fine-grained per-user permission overrides (INHERIT / ALLOW / DENY)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_permission_overrides (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module      VARCHAR(100) NOT NULL,
  submodule   VARCHAR(100) NOT NULL DEFAULT '',
  allow_mask  INTEGER NOT NULL DEFAULT 0,
  deny_mask   INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(user_id, module, submodule),
  CONSTRAINT chk_masks_no_overlap CHECK ((allow_mask & deny_mask) = 0)
);

CREATE INDEX IF NOT EXISTS idx_upo_user ON user_permission_overrides(user_id);
CREATE INDEX IF NOT EXISTS idx_upo_module ON user_permission_overrides(module, submodule);
