-- ============================================================
-- SILVERSTAR GROW — User Department Assignment
-- Adds department_id to users for departmental grouping/filtering.
-- ============================================================

ALTER TABLE users
ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);
