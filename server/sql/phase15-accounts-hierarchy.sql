-- ============================================================
-- Phase 15 — Chart of Accounts Multi-Level Hierarchy
-- Run once against the live database.
-- ============================================================

-- 1. Add hierarchy columns
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS level      INTEGER  DEFAULT 1,
  ADD COLUMN IF NOT EXISTS path       TEXT,
  ADD COLUMN IF NOT EXISTS is_posting BOOLEAN  DEFAULT TRUE;

-- 2. Backfill level, path from parent_id relationships
WITH RECURSIVE tree AS (
  -- Root nodes (no parent)
  SELECT id, code, 1 AS lvl, code::TEXT AS p
  FROM accounts
  WHERE parent_id IS NULL

  UNION ALL

  -- Children
  SELECT a.id, a.code, t.lvl + 1, t.p || '/' || a.code
  FROM accounts a
  JOIN tree t ON a.parent_id = t.id
)
UPDATE accounts a
SET    level = t.lvl,
       path  = t.p
FROM   tree t
WHERE  a.id = t.id;

-- 3. Set is_posting: group accounts are never posting accounts
UPDATE accounts SET is_posting = NOT is_group;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_accounts_path    ON accounts(path);
CREATE INDEX IF NOT EXISTS idx_accounts_level   ON accounts(level);
CREATE INDEX IF NOT EXISTS idx_accounts_posting ON accounts(is_posting);

-- Sanity check (run manually to verify):
-- SELECT id, code, name, is_group, level, path, is_posting
-- FROM accounts ORDER BY path, code LIMIT 20;
