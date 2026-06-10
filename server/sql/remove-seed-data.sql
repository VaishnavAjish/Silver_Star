-- ============================================================
-- SILVERSTAR GROW — Remove Seed / Demo Data
-- Reverses: sql/seed-data.sql  AND  database/seeds/001_seed_data.sql
--
-- Usage:
--   psql -U postgres -d silverstar_grow -f sql/remove-seed-data.sql
--
-- Safe: targets only the specific codes/usernames that were seeded.
-- Any data you created manually is left untouched.
-- ============================================================

BEGIN;

-- ── 1. Machines (depends on departments, locations) ───────────────────────────
DELETE FROM machines
WHERE code IN ('CVD-M-01','CVD-M-02','CVD-M-03','LASER-L1','POL-P1');

-- ── 2. Expense categories (depends on accounts) ───────────────────────────────
-- From seed-data.sql
DELETE FROM expense_categories
WHERE code IN ('ECAT-001','ECAT-002','ECAT-003','ECAT-004','ECAT-005','ECAT-006','ECAT-007');

-- From 001_seed_data.sql
DELETE FROM expense_categories
WHERE code IN ('ELEC','RENT','MAINT','LABOR','MISC');

-- ── 3. Departments (depends on locations) ─────────────────────────────────────
DELETE FROM departments
WHERE code IN ('DEPT-001','DEPT-002','DEPT-003','DEPT-004','DEPT-005','DEPT-006');

-- ── 4. Locations ──────────────────────────────────────────────────────────────
DELETE FROM locations
WHERE code IN ('LOC-001','LOC-002','LOC-003');

-- ── 5. Items ──────────────────────────────────────────────────────────────────
DELETE FROM items
WHERE code IN (
  'SEED-CVD-A','SEED-CVD-B','SEED-HPHT',
  'GAS-CH4','GAS-H2','GAS-N2','GAS-AR',
  'CON-POLPWD','CON-GRPHSUB','CON-MOLLY','CON-VACOIL','CON-CLNSOL',
  'RGH-CVD','RGH-HPHT'
);

-- ── 6. Vendors ────────────────────────────────────────────────────────────────
DELETE FROM vendors
WHERE code IN ('VND-001','VND-002','VND-003','VND-004','VND-005','VND-006');

-- ── 7. UOM ────────────────────────────────────────────────────────────────────
-- From seed-data.sql
DELETE FROM uom WHERE code IN ('PCS','CT','KG','GM','CYL','LTR','HR');
-- From 001_seed_data.sql
DELETE FROM uom WHERE code IN ('Pcs','Kg','G','L','M','Box','Bag');

-- ── 8. Accounts — leaf accounts first, then group/parent accounts ─────────────
-- Leaf accounts from seed-data.sql (5xxx, 4xxx, 3xxx, 2xxx, 1xxx)
DELETE FROM accounts
WHERE code IN (
  '1001','1002','1003','1004','1005',
  '2001','2002','2003','2004','2005',
  '3001','3002',
  '4001',
  '5001','5002','5003','5004','5005','5006','5007','5008'
);
-- Group accounts from seed-data.sql
DELETE FROM accounts WHERE code IN ('1000','2000','3000','4000','5000');

-- Leaf accounts from 001_seed_data.sql
DELETE FROM accounts
WHERE code IN (
  '1101','1102','1103','1104',
  '1201','1202',
  '2101','2102','2103',
  '31',
  '4101','4102','4103',
  '5101','5102',
  '5201','5202','5203','5204','5205'
);
-- Sub-group accounts from 001_seed_data.sql
DELETE FROM accounts WHERE code IN ('11','12','21','22','41','51','52');
-- Root group accounts from 001_seed_data.sql
DELETE FROM accounts WHERE code IN ('1','2','3','4','5');

-- ── 9. Users ──────────────────────────────────────────────────────────────────
-- Removes demo users. Remove the admin line below if you want to keep the admin.
DELETE FROM users WHERE username IN ('admin','operator1','viewer1');

COMMIT;

-- Verify nothing is left
SELECT 'machines'         AS tbl, COUNT(*) FROM machines         WHERE code IN ('CVD-M-01','CVD-M-02','CVD-M-03','LASER-L1','POL-P1')
UNION ALL
SELECT 'expense_categories', COUNT(*) FROM expense_categories WHERE code IN ('ECAT-001','ECAT-002','ECAT-003','ECAT-004','ECAT-005','ECAT-006','ECAT-007','ELEC','RENT','MAINT','LABOR','MISC')
UNION ALL
SELECT 'departments',      COUNT(*) FROM departments      WHERE code IN ('DEPT-001','DEPT-002','DEPT-003','DEPT-004','DEPT-005','DEPT-006')
UNION ALL
SELECT 'locations',        COUNT(*) FROM locations        WHERE code IN ('LOC-001','LOC-002','LOC-003')
UNION ALL
SELECT 'items',            COUNT(*) FROM items            WHERE code IN ('SEED-CVD-A','SEED-CVD-B','SEED-HPHT','GAS-CH4','GAS-H2','GAS-N2','GAS-AR','CON-POLPWD','CON-GRPHSUB','CON-MOLLY','CON-VACOIL','CON-CLNSOL','RGH-CVD','RGH-HPHT')
UNION ALL
SELECT 'vendors',          COUNT(*) FROM vendors          WHERE code IN ('VND-001','VND-002','VND-003','VND-004','VND-005','VND-006')
UNION ALL
SELECT 'uom',              COUNT(*) FROM uom              WHERE code IN ('PCS','CT','KG','GM','CYL','LTR','HR','Pcs','Kg','G','L','M','Box','Bag')
UNION ALL
SELECT 'accounts',         COUNT(*) FROM accounts         WHERE code IN ('1','2','3','4','5','11','12','21','22','31','41','51','52','1000','2000','3000','4000','5000','1001','1002','1003','1004','1005','2001','2002','2003','2004','2005','3001','3002','4001','5001','5002','5003','5004','5005','5006','5007','5008','1101','1102','1103','1104','1201','1202','2101','2102','2103','4101','4102','4103','5101','5102','5201','5202','5203','5204','5205')
UNION ALL
SELECT 'users',            COUNT(*) FROM users            WHERE username IN ('admin','operator1','viewer1');
