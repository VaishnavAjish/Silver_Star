CREATE TABLE IF NOT EXISTS expense_bills (
    id SERIAL PRIMARY KEY,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id),
    bill_no VARCHAR(100) NOT NULL UNIQUE,
    bill_date DATE NOT NULL,
    due_date DATE,
    memo TEXT,
    status VARCHAR(50) DEFAULT 'OPEN',
    amount_paid NUMERIC(15,2) DEFAULT 0,
    balance_due NUMERIC(15,2) DEFAULT 0,
    grand_total NUMERIC(15,2) DEFAULT 0,
    je_id INTEGER REFERENCES journal_entries(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS expense_bill_lines (
    id SERIAL PRIMARY KEY,
    expense_bill_id INTEGER NOT NULL REFERENCES expense_bills(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL DEFAULT 1,
    expense_account_id INTEGER NOT NULL REFERENCES accounts(id),
    description TEXT,
    department_id INTEGER REFERENCES departments(id),
    cost_center_id INTEGER REFERENCES cost_centers(id),
    amount NUMERIC(15,2) NOT NULL
);

-- I need to make sure Vendor Workspace / Payments integration works.
-- Existing vendor advances & payments system uses `purchase_notes` for bill settlement, or it joins on `purchase_notes`.
-- Wait! "Reuse existing Payments module."
-- In payments, does it look for `purchase_notes` exclusively, or can it look for `expense_bills`?
