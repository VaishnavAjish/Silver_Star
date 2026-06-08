-- Seed: Default accounts (INR-based Chart of Accounts)
INSERT INTO accounts (code, name, type, is_group) VALUES
('1', 'Assets', 'asset', TRUE),
('2', 'Liabilities', 'liability', TRUE),
('3', 'Equity', 'equity', TRUE),
('4', 'Revenue', 'revenue', TRUE),
('5', 'Expenses', 'expense', TRUE);

INSERT INTO accounts (code, name, type, parent_id, is_group) VALUES
('11', 'Current Assets', 'asset', 1, TRUE),
('12', 'Fixed Assets', 'asset', 1, TRUE),
('21', 'Current Liabilities', 'liability', 2, TRUE),
('22', 'Long-term Liabilities', 'liability', 2, TRUE),
('31', 'Retained Earnings', 'equity', 3, FALSE),
('41', 'Sales Revenue', 'revenue', 4, TRUE),
('51', 'Direct Expenses', 'expense', 5, TRUE),
('52', 'Indirect Expenses', 'expense', 5, TRUE);

INSERT INTO accounts (code, name, type, parent_id, is_group, description) VALUES
('1101', 'Cash', 'asset', 1, FALSE, 'Cash in hand'),
('1102', 'Bank Account', 'asset', 1, FALSE, 'Bank current account'),
('1103', 'Inventory Stock', 'asset', 1, FALSE, 'Raw material & finished goods'),
('1104', 'Accounts Receivable', 'asset', 1, FALSE, 'Customer receivables'),
('1201', 'Land & Building', 'asset', 1, FALSE, 'Property assets'),
('1202', 'Machinery', 'asset', 1, FALSE, 'Manufacturing equipment'),
('2101', 'Accounts Payable', 'liability', 2, FALSE, 'Vendor payables'),
('2102', 'GST Payable', 'liability', 2, FALSE, 'Tax payable'),
('2103', 'Salary Payable', 'liability', 2, FALSE, 'Employee salaries'),
('4101', 'Seed Sales', 'revenue', 4, FALSE, 'Revenue from seed sales'),
('4102', 'Gas Sales', 'revenue', 4, FALSE, 'Revenue from gas sales'),
('4103', 'Diamond Sales', 'revenue', 4, FALSE, 'Revenue from diamond sales'),
('5101', 'Raw Material Cost', 'expense', 5, FALSE, 'Direct material cost'),
('5102', 'Labor Cost', 'expense', 5, FALSE, 'Direct labor cost'),
('5201', 'Electricity', 'expense', 5, FALSE, 'Power & electricity'),
('5202', 'Rent', 'expense', 5, FALSE, 'Rent expense'),
('5203', 'Maintenance', 'expense', 5, FALSE, 'Repairs & maintenance'),
('5204', 'Depreciation', 'expense', 5, FALSE, 'Asset depreciation'),
('5205', 'Miscellaneous', 'expense', 5, FALSE, 'Other expenses');

-- Seed: Default admin user (password: admin123)
INSERT INTO users (username, email, password_hash, full_name, role) VALUES
('admin', 'admin@silverstargrow.com', crypt('admin123', gen_salt('bf')), 'System Administrator', 'super_admin');

-- Seed: Default UOMs
INSERT INTO uom (code, name, symbol, type) VALUES
('Pcs', 'Pieces', 'Pcs', 'count'),
('Kg', 'Kilogram', 'Kg', 'weight'),
('G', 'Gram', 'G', 'weight'),
('L', 'Liter', 'L', 'volume'),
('M', 'Meter', 'M', 'length'),
('Box', 'Box', 'Box', 'count'),
('Bag', 'Bag', 'Bag', 'count');

-- Seed: Expense categories
INSERT INTO expense_categories (code, name, gl_account_id, monthly_budget) VALUES
('ELEC', 'Electricity', (SELECT id FROM accounts WHERE code='5201'), 50000),
('RENT', 'Rent', (SELECT id FROM accounts WHERE code='5202'), 100000),
('MAINT', 'Maintenance', (SELECT id FROM accounts WHERE code='5203'), 25000),
('LABOR', 'Labor', (SELECT id FROM accounts WHERE code='5102'), 200000),
('MISC', 'Miscellaneous', (SELECT id FROM accounts WHERE code='5205'), 10000);
