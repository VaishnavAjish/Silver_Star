-- ============================================================
-- Phase 30: Manufacturing Return Engine
-- Run ONCE: psql $DATABASE_URL -f phase30_return_engine.sql
-- Safe to re-run (IF NOT EXISTS / IF EXISTS guards).
-- ============================================================
-- Implements:
--   • Genealogy-safe multi-line returns with sequential lot codes
--   • Partial return support (remaining_in_process tracking)
--   • New inventory statuses: REPROCESS, QC_HOLD, DISPOSED, LOW STOCK
--   • process_return_lines detail table
--   • Auto machine-process completion when all issues returned
-- ============================================================

BEGIN;

-- ── 1. Extend inventory status constraint ────────────────────────────────────
-- Drops and recreates to include REPROCESS, QC_HOLD, DISPOSED, LOW STOCK
-- (LOW STOCK and DISPOSED were referenced in code but missing from constraint)
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_status_valid;
ALTER TABLE inventory ADD CONSTRAINT inventory_status_valid
  CHECK (status IN (
    'IN STOCK', 'IN PROCESS', 'CONSUMED', 'DAMAGED',
    'SOLD', 'ARCHIVED', 'DISPOSED', 'LOW STOCK',
    'REPROCESS', 'QC_HOLD'
  ));

-- ── 2. Add remaining_in_process to lot_process_issues ───────────────────────
ALTER TABLE lot_process_issues
  ADD COLUMN IF NOT EXISTS remaining_in_process NUMERIC(12,4);

-- Initialize: open issues get full issued_qty as remaining
UPDATE lot_process_issues
  SET remaining_in_process = issued_qty
  WHERE status = 'OPEN' AND remaining_in_process IS NULL;

-- ── 3. Extend lot_process_returns for partial return tracking ────────────────
ALTER TABLE lot_process_returns
  ADD COLUMN IF NOT EXISTS is_final        BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS remaining_after NUMERIC(12,4) NOT NULL DEFAULT 0;

-- ── 4. Multi-line return detail table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS process_return_lines (
  id          SERIAL PRIMARY KEY,
  return_id   INTEGER      NOT NULL REFERENCES lot_process_returns(id) ON DELETE CASCADE,
  return_type VARCHAR(20)  NOT NULL
              CHECK (return_type IN ('usable','damaged','consumed','reprocess','qc_hold')),
  qty         NUMERIC(12,4) NOT NULL CHECK (qty > 0),
  lot_id      INTEGER REFERENCES inventory(id),
  lot_code    VARCHAR(100),
  remarks     TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_prl_return_id    ON process_return_lines(return_id);
CREATE INDEX IF NOT EXISTS idx_prl_lot_id       ON process_return_lines(lot_id);
CREATE INDEX IF NOT EXISTS idx_lpi_remaining    ON lot_process_issues(machine_process_id)
  WHERE status = 'OPEN';

COMMIT;
