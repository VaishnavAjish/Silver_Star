-- ============================================================
-- Phase 11: Account Sub-Type (QuickBooks-style classification)
-- ============================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sub_type VARCHAR(50);

-- Backfill existing accounts by name pattern
UPDATE accounts SET sub_type = 'bank'       WHERE sub_type IS NULL AND LOWER(name) LIKE '%bank%';
UPDATE accounts SET sub_type = 'cash'       WHERE sub_type IS NULL AND LOWER(name) LIKE '%cash%';
UPDATE accounts SET sub_type = 'receivable' WHERE sub_type IS NULL AND type = 'asset'     AND LOWER(name) LIKE '%receivable%';
UPDATE accounts SET sub_type = 'payable'    WHERE sub_type IS NULL AND type = 'liability' AND LOWER(name) LIKE '%payable%';
UPDATE accounts SET sub_type = 'inventory'  WHERE sub_type IS NULL AND type = 'asset'     AND LOWER(name) LIKE '%inventor%';
UPDATE accounts SET sub_type = 'fixed_asset'WHERE sub_type IS NULL AND type = 'asset'     AND (LOWER(name) LIKE '%fixed%' OR LOWER(name) LIKE '%equipment%' OR LOWER(name) LIKE '%machinery%');

CREATE INDEX IF NOT EXISTS idx_accounts_sub_type ON accounts(sub_type);
