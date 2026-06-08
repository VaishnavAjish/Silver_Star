-- ============================================================
-- Phase 19: Journal Entry Professional Upgrade
-- Safe additive migration — adds nullable columns only.
-- Existing JEs and balances are NOT touched.
-- Run: psql -d silverstar_grow -f phase19_je_entity_migration.sql
-- ============================================================

-- Entity/party linking on je_lines (vendor, customer, employee, etc.)
ALTER TABLE je_lines
  ADD COLUMN IF NOT EXISTS entity_type  VARCHAR(30),   -- 'vendor' | 'customer' | 'employee' | null
  ADD COLUMN IF NOT EXISTS entity_id    INTEGER,        -- FK to vendors.id / customers.id (soft ref)
  ADD COLUMN IF NOT EXISTS reference_no VARCHAR(50);    -- per-line reference / cheque / doc no

-- Reference number on journal entry header
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS reference_no VARCHAR(50);   -- header-level ref (bill no, bank ref, etc.)

-- Indexes
CREATE INDEX IF NOT EXISTS idx_je_lines_entity ON je_lines(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_je_ref           ON journal_entries(reference_no);

-- Verification query (run to confirm columns exist)
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name IN ('je_lines','journal_entries')
--     AND column_name IN ('entity_type','entity_id','reference_no')
--   ORDER BY table_name, column_name;
