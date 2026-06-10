-- ============================================================
-- Silverstar Grow - Accounts with current data
-- Exported from local database silverstar_grow on 2026-06-10.
--
-- Prerequisite: run the project schema and account hierarchy
-- migrations before this file.
--
-- Usage:
--   psql -U postgres -d silverstar_grow -f sql/accounts-with-data.sql
-- ============================================================

BEGIN;

CREATE TEMP TABLE account_seed (
  code         VARCHAR(20) PRIMARY KEY,
  name         VARCHAR(150) NOT NULL,
  type         TEXT NOT NULL,
  parent_code  VARCHAR(20),
  is_group     BOOLEAN NOT NULL,
  currency     VARCHAR(3) NOT NULL,
  balance      NUMERIC(15,2) NOT NULL,
  status       TEXT NOT NULL,
  description  TEXT,
  sub_type     VARCHAR(50),
  level        INTEGER NOT NULL,
  path         TEXT NOT NULL,
  is_posting   BOOLEAN NOT NULL
) ON COMMIT DROP;

INSERT INTO account_seed
  (code, name, type, parent_code, is_group, currency, balance, status,
   description, sub_type, level, path, is_posting)
VALUES
  ('1000',  'Assets',                     'asset',     NULL,    TRUE,  'INR',         0.00, 'active', NULL, NULL,          1, '1000',            FALSE),
  ('2000',  'Inventory',                  'asset',     NULL,    TRUE,  'INR',         0.00, 'active', NULL, 'inventory',   1, '2000',            FALSE),
  ('2050',  'Customer Advance Received',  'liability', NULL,    FALSE, 'INR',   8855150.00, 'active', 'Advance receipts from customers, to be adjusted against future invoices', 'other', 1, '2050', TRUE),
  ('3000',  'Liabilities',                'liability', NULL,    TRUE,  'INR',         0.00, 'active', NULL, NULL,          1, '3000',            FALSE),
  ('4000',  'Revenue',                    'revenue',   NULL,    TRUE,  'INR',         0.00, 'active', NULL, NULL,          1, '4000',            FALSE),
  ('4100',  'Loan against Exports',       'liability', NULL,    FALSE, 'INR', 339764631.00, 'active', NULL, NULL,          1, '4100',            TRUE),
  ('4200',  'Share Capital',              'equity',    NULL,    FALSE, 'INR', 180000000.00, 'active', NULL, NULL,          1, '4200',            TRUE),
  ('5000',  'Expenses',                   'expense',   NULL,    TRUE,  'INR',         0.00, 'active', NULL, NULL,          1, '5000',            FALSE),

  ('1000A', 'Bank Accounts',              'asset',     '1000',  TRUE,  'INR',         0.00, 'active', NULL, 'bank',        2, '1000/1000A',      FALSE),
  ('1000B', 'Accounts Receivable (A/R)',  'asset',     '1000',  TRUE,  'INR',         0.00, 'active', 'Sundry Debtors', 'receivable', 2, '1000/1000B', FALSE),
  ('1000C', 'Advances & Deposits',        'asset',     '1000',  TRUE,  'INR',         0.00, 'active', 'Advance Paid or Deposits', 'other', 2, '1000/1000C', FALSE),
  ('2000A', 'Fixed Asset',                'asset',     '1000',  TRUE,  'INR',         0.00, 'active', NULL, NULL,          2, '1000/2000A',      FALSE),
  ('2001',  'Raw Material - Seeds',       'asset',     '2000',  FALSE, 'INR',   4480000.00, 'active', 'CVD/HPHT seed inventory value', 'inventory', 2, '2000/2001', TRUE),
  ('2002',  'Raw Material - Gas',         'asset',     '2000',  FALSE, 'INR',         0.00, 'active', 'Gas cylinder inventory value', NULL, 2, '2000/2002', TRUE),
  ('2003',  'Raw Material - Consumables', 'asset',     '2000',  FALSE, 'INR',         0.00, 'active', 'Consumables inventory value', NULL, 2, '2000/2003', TRUE),
  ('2004',  'Rough Diamond Inventory',    'asset',     '2000',  FALSE, 'INR',    186500.00, 'active', 'Finished rough diamond stock value', 'inventory', 2, '2000/2004', TRUE),
  ('2005',  'Work-in-Progress',           'asset',     '2000',  FALSE, 'INR',   -186500.00, 'active', 'Materials currently in process', NULL, 2, '2000/2005', TRUE),
  ('3000B', 'Loans & Liabilities',        'liability', '3000',  TRUE,  'INR',         0.00, 'active', NULL, 'loan',        2, '3000/3000B',      FALSE),
  ('3001',  'Accounts Payable',           'liability', '3000',  FALSE, 'INR',   5187324.77, 'active', 'Money owed to vendors', 'payable', 2, '3000/3001', TRUE),
  ('3002',  'GST Payable',                'liability', '3000',  FALSE, 'INR',    -13950.00, 'active', 'GST output tax liability', 'payable', 2, '3000/3002', TRUE),
  ('3004',  'SL Capital',                 'liability', '3000',  FALSE, 'INR',         0.00, 'active', NULL, NULL,          2, '3000/3004',       TRUE),
  ('4001',  'Rough Diamond Sales',        'revenue',   '4000',  FALSE, 'INR',         0.00, 'active', 'Revenue from rough diamond sales', NULL, 2, '4000/4001', TRUE),
  ('4099',  'Gain on Asset Disposal',     'revenue',   '4000',  FALSE, 'INR',         0.00, 'active', 'Gain recognised on disposal of fixed assets', NULL, 2, '4000/4099', TRUE),
  ('5001',  'COGS - Seeds',               'expense',   '5000',  FALSE, 'INR',         0.00, 'active', 'Cost of seeds consumed', NULL, 2, '5000/5001', TRUE),
  ('5002',  'COGS - Gas',                 'expense',   '5000',  FALSE, 'INR',         0.00, 'active', 'Cost of gas consumed in production', NULL, 2, '5000/5002', TRUE),
  ('5003',  'COGS - Power',               'expense',   '5000',  FALSE, 'INR',         0.00, 'active', 'Electricity and power costs', NULL, 2, '5000/5003', TRUE),
  ('5004',  'Operating Expenses',         'expense',   '5000',  FALSE, 'INR',         0.00, 'active', 'General operating expenses', NULL, 2, '5000/5004', TRUE),
  ('5005',  'Salaries & Wages',           'expense',   '5000',  FALSE, 'INR',         0.00, 'active', 'Staff salaries and wages', NULL, 2, '5000/5005', TRUE),
  ('5006',  'Rent',                       'expense',   '5000',  FALSE, 'INR',         0.00, 'active', 'Factory and office rent', NULL, 2, '5000/5006', TRUE),
  ('5007',  'Insurance',                  'expense',   '5000',  FALSE, 'INR',         0.00, 'active', 'Insurance premiums', NULL, 2, '5000/5007', TRUE),
  ('5008',  'Machine Maintenance',        'expense',   '5000',  FALSE, 'INR',         0.00, 'active', 'Maintenance and repair costs', NULL, 2, '5000/5008', TRUE),
  ('5009',  'Depreciation Expense',       'expense',   '5000',  FALSE, 'INR',    215096.01, 'active', 'Periodic depreciation charge on fixed assets', NULL, 2, '5000/5009', TRUE),
  ('5010',  'Loss on Asset Disposal',     'expense',   '5000',  FALSE, 'INR',         0.00, 'active', 'Loss recognised on disposal of fixed assets', NULL, 2, '5000/5010', TRUE),
  ('5011',  'Exchange Loss / Gain',       'expense',   '5000',  FALSE, 'INR',         0.00, 'active', NULL, NULL,          2, '5000/5011',       TRUE),

  ('1001',  'Cash A/c',                   'asset',     '1000A', FALSE, 'INR',         0.00, 'active', 'Cash on hand', 'cash', 3, '1000/1000A/1001', TRUE),
  ('1002',  'Indusind Bank',              'asset',     '1000A', FALSE, 'INR',         0.00, 'active', 'Indusind Bank current account', 'bank', 3, '1000/1000A/1002', TRUE),
  ('1003',  'Petty Cash A/c',             'asset',     '1000A', FALSE, 'INR',         0.00, 'active', 'Petty cash account', 'cash', 3, '1000/1000A/1003', TRUE),
  ('1004',  'ICICI Bank',                 'asset',     '1000A', FALSE, 'INR', 510102150.26, 'active', 'ICICI Bank current account', 'bank', 3, '1000/1000A/1004', TRUE),
  ('1005',  'Accounts Receivable',        'asset',     '1000B', FALSE, 'INR',         0.00, 'active', 'Money owed by customers', 'receivable', 3, '1000/1000B/1005', TRUE),
  ('1050',  'Vendor Advance (Prepaid)',   'asset',     '1000C', FALSE, 'INR',      3150.02, 'active', 'Advance payments made to vendors, to be adjusted against future bills', 'other', 3, '1000/1000C/1050', TRUE),
  ('2007',  'Plant & Machinery',          'asset',     '2000A', FALSE, 'INR',  17580374.55, 'active', 'Plant and machinery assets', 'fixed_asset', 3, '1000/2000A/2007', TRUE),
  ('2008',  'Office Equipment',           'asset',     '2000A', FALSE, 'INR',         0.00, 'active', 'Office equipment assets', 'fixed_asset', 3, '1000/2000A/2008', TRUE),
  ('2009',  'Furniture & Fixtures',       'asset',     '2000A', FALSE, 'INR',   1627480.94, 'active', 'Furniture and fixtures', 'fixed_asset', 3, '1000/2000A/2009', TRUE),
  ('2010',  'Computers & IT Equipment',   'asset',     '2000A', FALSE, 'INR',         0.00, 'active', 'Computers and IT equipment', 'fixed_asset', 3, '1000/2000A/2010', TRUE),
  ('2011',  'Vehicles',                   'asset',     '2000A', FALSE, 'INR',         0.00, 'active', 'Vehicles and transport assets', NULL, 3, '1000/2000A/2011', TRUE),
  ('2099',  'Accumulated Depreciation',   'asset',     '2000A', FALSE, 'INR',   -215096.01, 'active', 'Accumulated depreciation - contra asset (credit balance)', NULL, 3, '1000/2000A/2099', TRUE),
  ('3005',  'Loan-Nidhi Impex',           'liability', '3000B', FALSE, 'INR',         0.00, 'active', NULL, 'loan',        3, '3000/3000B/3005', TRUE);

-- Insert new accounts and refresh existing accounts by their stable code.
INSERT INTO accounts
  (code, name, type, is_group, currency, balance, status, description,
   sub_type, level, path, is_posting)
SELECT
  code,
  name,
  type::account_type,
  is_group,
  currency,
  balance,
  status::account_status,
  description,
  sub_type,
  level,
  path,
  is_posting
FROM account_seed
ORDER BY level, path
ON CONFLICT (code) DO UPDATE SET
  name        = EXCLUDED.name,
  type        = EXCLUDED.type,
  is_group    = EXCLUDED.is_group,
  currency    = EXCLUDED.currency,
  balance     = EXCLUDED.balance,
  status      = EXCLUDED.status,
  description = EXCLUDED.description,
  sub_type    = EXCLUDED.sub_type,
  level       = EXCLUDED.level,
  path        = EXCLUDED.path,
  is_posting  = EXCLUDED.is_posting,
  updated_at  = NOW();

-- Resolve hierarchy after every account code exists.
UPDATE accounts AS a
SET parent_id = p.id
FROM account_seed AS s
LEFT JOIN accounts AS p ON p.code = s.parent_code
WHERE a.code = s.code
  AND a.parent_id IS DISTINCT FROM p.id;

SELECT setval(
  pg_get_serial_sequence('accounts', 'id'),
  (SELECT MAX(id) FROM accounts),
  TRUE
);

-- Verification
SELECT COUNT(*) AS seeded_account_count
FROM accounts
WHERE code IN (SELECT code FROM account_seed);

COMMIT;
