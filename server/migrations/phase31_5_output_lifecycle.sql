-- ============================================================
-- Phase 31.5: Output-Based Manufacturing Lifecycle Engine
-- Run ONCE: psql $DATABASE_URL -f phase31_5_output_lifecycle.sql
-- Safe to re-run (IF NOT EXISTS / IF EXISTS guards).
-- ============================================================
-- Problem: machine_processes auto-completed when all seed qty was
--   returned.  For CVD growth, seed return ≠ growth completion.
--   The growth cycle must remain ACTIVE until rough output is posted.
-- Fix:
--   1. Add awaiting_output to machine_status ENUM
--   2. Add completion_mode to process_master (RETURN_BASED / OUTPUT_BASED)
--   3. Mark growth/polishing/cutting as OUTPUT_BASED
--   4. Add output lifecycle columns to machine_processes
-- ============================================================

-- ── 1. Extend machine_status ENUM ────────────────────────────────────────────
-- Uses IF NOT EXISTS to safely add the enum value idempotently.
-- This must execute outside of any BEGIN/COMMIT block.
ALTER TYPE machine_status ADD VALUE IF NOT EXISTS 'awaiting_output';

-- ── 2-4. Remaining DDL/DML in a single atomic transaction ────────────────────
BEGIN;

-- ── 2. Add completion_mode to process_master ─────────────────────────────────
ALTER TABLE process_master
  ADD COLUMN IF NOT EXISTS completion_mode VARCHAR(20) NOT NULL DEFAULT 'RETURN_BASED'
    CHECK (completion_mode IN ('RETURN_BASED', 'OUTPUT_BASED'));

-- ── 3. Mark transformation processes as OUTPUT_BASED ─────────────────────────
-- growth    — CVD growth: seeds returned but rough biscuit still in chamber
-- polishing — polished output must be recorded before process closes
-- cutting   — cut output must be recorded before process closes
UPDATE process_master
   SET completion_mode = 'OUTPUT_BASED'
 WHERE process_code IN ('growth', 'polishing', 'cutting');

-- ── 4. Add output lifecycle fields to machine_processes ──────────────────────
ALTER TABLE machine_processes
  ADD COLUMN IF NOT EXISTS output_entry_id     INTEGER,
  ADD COLUMN IF NOT EXISTS output_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_output_qty   NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS actual_yield_pct    NUMERIC(6,2);

-- Sparse index — most processes have no output_entry_id
CREATE INDEX IF NOT EXISTS idx_mp_output_entry
  ON machine_processes(output_entry_id)
  WHERE output_entry_id IS NOT NULL;

COMMIT;

-- ── Validation ────────────────────────────────────────────────────────────────
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'machine_status'::regtype AND enumlabel = 'awaiting_output'
  ) THEN 'OK — awaiting_output enum value added'
  ELSE 'FAIL — awaiting_output missing from enum'
  END AS enum_check,

  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'process_master' AND column_name = 'completion_mode'
  ) THEN 'OK — completion_mode column present on process_master'
  ELSE 'FAIL — completion_mode missing'
  END AS completion_mode_check,

  CASE WHEN EXISTS (
    SELECT 1 FROM process_master
    WHERE process_code = 'growth' AND completion_mode = 'OUTPUT_BASED'
  ) THEN 'OK — growth process set to OUTPUT_BASED'
  ELSE 'FAIL — growth still RETURN_BASED'
  END AS growth_mode_check,

  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'machine_processes' AND column_name = 'actual_output_qty'
  ) THEN 'OK — output lifecycle columns added to machine_processes'
  ELSE 'FAIL — output columns missing'
  END AS output_columns_check;
