ALTER TABLE accounts ADD COLUMN IF NOT EXISTS account_role VARCHAR(50) UNIQUE;
CREATE INDEX IF NOT EXISTS idx_accounts_role ON accounts(account_role);

UPDATE accounts SET account_role = 'ACCOUNTS_PAYABLE' WHERE id = 3001;
UPDATE accounts SET account_role = 'ACCOUNTS_RECEIVABLE' WHERE id = 4001;
UPDATE accounts SET account_role = 'GST_PAYABLE' WHERE id = 3002;
UPDATE accounts SET account_role = 'SALES_REVENUE' WHERE id = 6001;
UPDATE accounts SET account_role = 'INVENTORY_SEED' WHERE id = 1004;
UPDATE accounts SET account_role = 'INVENTORY_ROUGH' WHERE id = 1005;
UPDATE accounts SET account_role = 'INVENTORY_GROWTH_RUN' WHERE id = 1006;
UPDATE accounts SET account_role = 'FIXED_ASSET' WHERE id = 1001;
UPDATE accounts SET account_role = 'ACCUMULATED_DEPRECIATION' WHERE id = 1002;
UPDATE accounts SET account_role = 'DEPRECIATION_EXPENSE' WHERE id = 8001;
UPDATE accounts SET account_role = 'BANK_MAIN' WHERE id = 1003;
UPDATE accounts SET account_role = 'CASH_MAIN' WHERE id = 1007;
UPDATE accounts SET account_role = 'COGS' WHERE id = 7001;
