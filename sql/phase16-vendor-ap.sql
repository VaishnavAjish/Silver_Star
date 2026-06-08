-- Phase 16: Vendor AP Sub-ledger Module
-- Non-destructive: only adds a nullable column. Safe to re-run.
-- Run once against the live database.

-- Link vendors to their Accounts Payable sub-ledger account (optional)
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN vendors.account_id IS 'Optional AP sub-ledger account in the chart of accounts (accounts.id)';
