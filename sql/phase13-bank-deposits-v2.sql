-- ============================================================
-- Phase 13: Bank Deposits v2 — Received-From Party Tracking
-- Run AFTER bank-deposits.sql
-- ============================================================

-- Add received-from party tracking to deposit lines
ALTER TABLE bank_deposit_lines
  ADD COLUMN IF NOT EXISTS received_from_type VARCHAR(20),   -- 'customer', 'vendor', 'other'
  ADD COLUMN IF NOT EXISTS received_from_id   INTEGER;       -- customers.id or vendors.id (null for 'other')

-- Index for reporting by party
CREATE INDEX IF NOT EXISTS idx_bdl_received_from
  ON bank_deposit_lines(received_from_type, received_from_id);

COMMENT ON COLUMN bank_deposit_lines.received_from_type IS 'customer | vendor | other';
COMMENT ON COLUMN bank_deposit_lines.received_from_id   IS 'FK to customers.id or vendors.id depending on type';
