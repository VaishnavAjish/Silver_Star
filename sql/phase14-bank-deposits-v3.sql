-- ============================================================
-- Phase 14 — Bank Deposits v3 (status + reversal support)
-- ============================================================
-- Run once against the live database.

-- 1. Add status column (all existing rows are 'posted')
ALTER TABLE bank_deposits
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'posted';

-- 2. Add reverse_je_id to track the reversal journal entry
ALTER TABLE bank_deposits
  ADD COLUMN IF NOT EXISTS reverse_je_id INTEGER REFERENCES journal_entries(id);

-- 3. Index for status queries
CREATE INDEX IF NOT EXISTS idx_bank_deposits_status ON bank_deposits(status);

-- Verification:
-- SELECT id, status, reverse_je_id FROM bank_deposits LIMIT 5;
