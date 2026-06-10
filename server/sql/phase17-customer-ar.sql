-- Phase 17: Customer AR sub-ledger — add optional chart-of-accounts link
ALTER TABLE customers ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;
COMMENT ON COLUMN customers.account_id IS 'Optional AR sub-ledger account in the chart of accounts (accounts.id)';
