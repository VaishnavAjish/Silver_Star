-- ============================================================
-- Phase 31: Allow Multiple Return Batches Per Process Issue
-- Run ONCE: psql $DATABASE_URL -f phase31_allow_multiple_returns.sql
-- Safe to re-run (IF EXISTS guard).
-- ============================================================
-- Problem: lot_process_returns had UNIQUE(issue_id), blocking
--   partial/progressive returns introduced in Phase 30.
-- Fix: drop that constraint. A non-unique index (idx_lpr_issue)
--   already exists on issue_id for efficient FK lookups.
-- ============================================================

BEGIN;

ALTER TABLE lot_process_returns
  DROP CONSTRAINT IF EXISTS lot_process_returns_issue_id_key;

COMMIT;

-- Validate: confirm constraint is gone, index remains
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'lot_process_returns'::regclass
      AND conname  = 'lot_process_returns_issue_id_key'
  ) THEN 'FAIL — constraint still present'
  ELSE 'OK — unique constraint removed'
  END AS constraint_check,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'lot_process_returns'
      AND indexname  = 'idx_lpr_issue'
  ) THEN 'OK — non-unique index retained'
  ELSE 'WARN — lookup index missing'
  END AS index_check;
