-- ============================================================
-- SILVERSTAR GROW — Seed Data
-- ============================================================

-- DEFAULT ADMIN USER (password: admin123)
INSERT INTO users (username, email, password_hash, full_name, role) VALUES
('admin', 'admin@silverstar.in', crypt('admin123', gen_salt('bf')), 'Dharmesh Shah', 'super_admin'),
('operator1', 'op1@silverstar.in', crypt('op12345', gen_salt('bf')), 'Rakesh Sharma', 'operator'),
('viewer1', 'view1@silverstar.in', crypt('view123', gen_salt('bf')), 'Nita Patel', 'viewer');

-- ============================================================
-- CHART OF ACCOUNTS (Default COA for manufacturing)
-- ============================================================
-- Group accounts (is_group = true)
INSERT INTO accounts (code, name, type, is_group) VALUES
('1000', 'Assets', 'asset', true),
('2000', 'Inventory', 'asset', true),
('3000', 'Liabilities', 'liability', true),
('4000', 'Revenue', 'revenue', true),
('5000', 'Expenses', 'expense', true);

-- Asset accounts
INSERT INTO accounts (code, name, type, parent_id, description) VALUES
('1001', 'Cash A/c', 'asset', (SELECT id FROM accounts WHERE code='1000'), 'Cash on hand'),
('1002', 'Bank - HDFC', 'asset', (SELECT id FROM accounts WHERE code='1000'), 'HDFC Bank current account'),
('1003', 'Accounts Receivable', 'asset', (SELECT id FROM accounts WHERE code='1000'), 'Money owed by customers'),
('1004', 'Bank - ICICI', 'asset', (SELECT id FROM accounts WHERE code='1000'), 'ICICI Bank current account'),
('1005', 'Petty Cash A/c', 'asset', (SELECT id FROM accounts WHERE code='1000'), 'Petty cash account');

-- Inventory accounts
INSERT INTO accounts (code, name, type, parent_id, description) VALUES
('2001', 'Raw Material - Seeds', 'asset', (SELECT id FROM accounts WHERE code='2000'), 'CVD/HPHT seed inventory value'),
('2002', 'Raw Material - Gas', 'asset', (SELECT id FROM accounts WHERE code='2000'), 'Gas cylinder inventory value'),
('2003', 'Raw Material - Consumables', 'asset', (SELECT id FROM accounts WHERE code='2000'), 'Consumables inventory value'),
('2004', 'Rough Diamond Inventory', 'asset', (SELECT id FROM accounts WHERE code='2000'), 'Finished rough diamond stock value'),
('2005', 'Work-in-Progress', 'asset', (SELECT id FROM accounts WHERE code='2000'), 'Materials currently in process');

-- Liability accounts
INSERT INTO accounts (code, name, type, parent_id, description) VALUES
('3001', 'Accounts Payable', 'liability', (SELECT id FROM accounts WHERE code='3000'), 'Money owed to vendors'),
('3002', 'GST Payable', 'liability', (SELECT id FROM accounts WHERE code='3000'), 'GST output tax liability');

-- Revenue accounts
INSERT INTO accounts (code, name, type, parent_id, description) VALUES
('4001', 'Rough Diamond Sales', 'revenue', (SELECT id FROM accounts WHERE code='4000'), 'Revenue from rough diamond sales');

-- Expense accounts
INSERT INTO accounts (code, name, type, parent_id, description) VALUES
('5001', 'COGS - Seeds', 'expense', (SELECT id FROM accounts WHERE code='5000'), 'Cost of seeds consumed'),
('5002', 'COGS - Gas', 'expense', (SELECT id FROM accounts WHERE code='5000'), 'Cost of gas consumed in production'),
('5003', 'COGS - Power', 'expense', (SELECT id FROM accounts WHERE code='5000'), 'Electricity and power costs'),
('5004', 'Operating Expenses', 'expense', (SELECT id FROM accounts WHERE code='5000'), 'General operating expenses'),
('5005', 'Salaries & Wages', 'expense', (SELECT id FROM accounts WHERE code='5000'), 'Staff salaries and wages'),
('5006', 'Rent', 'expense', (SELECT id FROM accounts WHERE code='5000'), 'Factory and office rent'),
('5007', 'Insurance', 'expense', (SELECT id FROM accounts WHERE code='5000'), 'Insurance premiums'),
('5008', 'Machine Maintenance', 'expense', (SELECT id FROM accounts WHERE code='5000'), 'Maintenance and repair costs');

-- ============================================================
-- LOCATIONS
-- ============================================================
INSERT INTO locations (code, name, type, address, city, state, manager) VALUES
('LOC-001', 'Surat Factory', 'factory', 'Diamond Nagar, Varachha', 'Surat', 'Gujarat', 'Rakesh Sharma'),
('LOC-002', 'Surat Office', 'office', 'Mahidharpura, Ring Road', 'Surat', 'Gujarat', 'Dharmesh Shah'),
('LOC-003', 'Mumbai Office', 'office', 'BDB, Bandra Kurla Complex', 'Mumbai', 'Maharashtra', NULL);

-- ============================================================
-- DEPARTMENTS
-- ============================================================
INSERT INTO departments (code, name, head, location_id, staff_count) VALUES
('DEPT-001', 'Grow Unit - A', 'Rakesh Sharma', (SELECT id FROM locations WHERE code='LOC-001'), 8),
('DEPT-002', 'Grow Unit - B', 'Vijay Patel', (SELECT id FROM locations WHERE code='LOC-001'), 6),
('DEPT-003', 'Cut & Polish', 'Sunil Mehta', (SELECT id FROM locations WHERE code='LOC-001'), 12),
('DEPT-004', 'Quality Control', 'Priya Desai', (SELECT id FROM locations WHERE code='LOC-001'), 4),
('DEPT-005', 'Admin', 'Dharmesh Shah', (SELECT id FROM locations WHERE code='LOC-002'), 3),
('DEPT-006', 'Accounts', 'Nita Patel', (SELECT id FROM locations WHERE code='LOC-002'), 2);

-- ============================================================
-- UOM
-- ============================================================
INSERT INTO uom (code, name, symbol, type) VALUES
('PCS', 'Pieces', 'pcs', 'count'),
('CT', 'Carat', 'ct', 'weight'),
('KG', 'Kilogram', 'kg', 'weight'),
('GM', 'Gram', 'g', 'weight'),
('CYL', 'Cylinder', 'cyl', 'volume'),
('LTR', 'Litre', 'L', 'volume'),
('HR', 'Hour', 'hr', 'time');

-- ============================================================
-- ITEMS (Item Master)
-- ============================================================
INSERT INTO items (code, name, category, type, default_uom, hsn_code, reorder_level) VALUES
('SEED-CVD-A', 'CVD Seed Type-A (4x4mm IIa)', 'seed', 'raw_material', 'PCS', '71023100', 20),
('SEED-CVD-B', 'CVD Seed Type-B (5x5mm IIa)', 'seed', 'raw_material', 'PCS', '71023100', 10),
('SEED-HPHT', 'HPHT Seed Type Ib', 'seed', 'raw_material', 'PCS', '71023100', 15),
('GAS-CH4', 'Methane (CH₄) Industrial', 'gas', 'raw_material', 'CYL', '28041000', 2),
('GAS-H2', 'Hydrogen (H₂) Ultra Pure', 'gas', 'raw_material', 'CYL', '28041000', 2),
('GAS-N2', 'Nitrogen (N₂) Purge Grade', 'gas', 'raw_material', 'CYL', '28041000', 1),
('GAS-AR', 'Argon (Ar) Shielding', 'gas', 'raw_material', 'CYL', '28042100', 1),
('CON-POLPWD', 'Diamond Polishing Powder', 'consumable', 'raw_material', 'KG', '28499090', 5),
('CON-GRPHSUB', 'Graphite Substrate Plate', 'consumable', 'raw_material', 'PCS', '38019000', 10),
('CON-MOLLY', 'Molybdenum Wire 0.25mm', 'consumable', 'raw_material', 'KG', '81029600', 2),
('CON-VACOIL', 'Vacuum Pump Oil', 'consumable', 'raw_material', 'LTR', '27101990', 5),
('CON-CLNSOL', 'Cleaning Solution', 'consumable', 'raw_material', 'LTR', '34021900', 3),
('RGH-CVD', 'CVD Rough Diamond', 'rough', 'finished_good', 'CT', '71023100', 0),
('RGH-HPHT', 'HPHT Rough Diamond', 'rough', 'finished_good', 'CT', '71023100', 0);

-- ============================================================
-- VENDORS
-- ============================================================
INSERT INTO vendors (code, name, category, contact_person, phone, city, state, gstin, payment_term) VALUES
('VND-001', 'Seed Supply Co.', 'seed', 'Rajesh Patel', '+91 98765 43210', 'Surat', 'Gujarat', '24ABCDE1234F1Z5', '7 Days'),
('VND-002', 'Gas Authority of India', 'gas', 'Amit Shah', '+91 90123 45678', 'Surat', 'Gujarat', '24FGHIJ5678K2Z3', 'Immediate'),
('VND-003', 'H2 Gases Pvt. Ltd.', 'gas', 'Suresh Kumar', '+91 87654 32109', 'Ahmedabad', 'Gujarat', '24KLMNO9012P3Z1', 'Immediate'),
('VND-004', 'Abrasive Supplies India', 'consumable', 'Meena Devi', '+91 76543 21098', 'Mumbai', 'Maharashtra', '27PQRST3456U4Z9', '30 Days'),
('VND-005', 'DiaSeed International', 'seed', 'John Miller', '+1 212 555 0147', 'New York', 'NY, USA', NULL, '30 Days'),
('VND-006', 'Linde India Ltd.', 'gas', 'Priya Sharma', '+91 98012 34567', 'Pune', 'Maharashtra', '27UVWXY7890Z5A2', '15 Days');

-- ============================================================
-- MACHINES
-- ============================================================
INSERT INTO machines (code, name, type, department_id, location_id, capacity, last_service, next_service, status) VALUES
('CVD-M-01', 'CVD Reactor Unit 1', 'CVD Reactor', (SELECT id FROM departments WHERE code='DEPT-001'), (SELECT id FROM locations WHERE code='LOC-001'), '6 seeds/batch', '2025-03-15', '2025-06-15', 'running'),
('CVD-M-02', 'CVD Reactor Unit 2', 'CVD Reactor', (SELECT id FROM departments WHERE code='DEPT-001'), (SELECT id FROM locations WHERE code='LOC-001'), '6 seeds/batch', '2025-04-01', '2025-07-01', 'running'),
('CVD-M-03', 'CVD Reactor Unit 3', 'CVD Reactor', (SELECT id FROM departments WHERE code='DEPT-002'), (SELECT id FROM locations WHERE code='LOC-001'), '4 seeds/batch', '2025-02-10', '2025-05-10', 'maintenance'),
('LASER-L1', 'Laser Cutter LS-500', 'Laser', (SELECT id FROM departments WHERE code='DEPT-003'), (SELECT id FROM locations WHERE code='LOC-001'), '50 pcs/day', '2025-03-20', '2025-06-20', 'running'),
('POL-P1', 'Polishing Station 1', 'Polisher', (SELECT id FROM departments WHERE code='DEPT-003'), (SELECT id FROM locations WHERE code='LOC-001'), '20 pcs/day', '2025-04-05', '2025-07-05', 'running');

-- ============================================================
-- EXPENSE CATEGORIES
-- ============================================================
INSERT INTO expense_categories (code, name, gl_account_id, monthly_budget) VALUES
('ECAT-001', 'Electricity & Power', (SELECT id FROM accounts WHERE code='5003'), 350000),
('ECAT-002', 'Direct Labour', (SELECT id FROM accounts WHERE code='5004'), 200000),
('ECAT-003', 'Machine Maintenance', (SELECT id FROM accounts WHERE code='5008'), 50000),
('ECAT-004', 'Rent', (SELECT id FROM accounts WHERE code='5006'), 80000),
('ECAT-005', 'Salaries & Wages', (SELECT id FROM accounts WHERE code='5005'), 320000),
('ECAT-006', 'Insurance', (SELECT id FROM accounts WHERE code='5007'), 25000),
('ECAT-007', 'Transport & Logistics', (SELECT id FROM accounts WHERE code='5004'), 30000);
