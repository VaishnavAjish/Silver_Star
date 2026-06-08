-- ============================================================
-- Phase 28: Start Process Workflow — machine linkage for lot_process_issues
-- Run ONCE: psql $DATABASE_URL -f phase28_start_process_workflow.sql
-- Safe to re-run (IF NOT EXISTS / IF EXISTS guards).
-- ============================================================

BEGIN;

-- Add machine-process linkage columns to lot_process_issues
ALTER TABLE lot_process_issues
  ADD COLUMN IF NOT EXISTS machine_id          INTEGER REFERENCES machines(id),
  ADD COLUMN IF NOT EXISTS operator_id         INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS machine_process_id  INTEGER REFERENCES machine_processes(id),
  ADD COLUMN IF NOT EXISTS process_type        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS target_runtime_hours NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS expected_rough_qty  NUMERIC(10,3);

-- Performance indexes for new FK columns
CREATE INDEX IF NOT EXISTS idx_lpi_machine_id         ON lot_process_issues(machine_id);
CREATE INDEX IF NOT EXISTS idx_lpi_machine_process_id ON lot_process_issues(machine_process_id);
CREATE INDEX IF NOT EXISTS idx_lpi_operator_id        ON lot_process_issues(operator_id);

COMMIT;
