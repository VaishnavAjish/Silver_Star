-- Phase 79: Manual Bill TDS Withholding Subledger & Role Assignment
-- Creates bill_tds_withholdings table and assigns TDS_PAYABLE role to Account 3004

BEGIN;

-- 1. Create bill_tds_withholdings table
CREATE TABLE IF NOT EXISTS bill_tds_withholdings (
    id SERIAL PRIMARY KEY,
    purchase_note_id INT NOT NULL,
    vendor_id INT NOT NULL REFERENCES vendors(id),
    tds_account_id INT NOT NULL REFERENCES accounts(id),
    nature TEXT,
    section_reference VARCHAR(100),
    rate_percent NUMERIC(5,2),
    tds_amount NUMERIC(15,2) NOT NULL CHECK (tds_amount > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
    posting_je_id INT REFERENCES journal_entries(id),
    reversal_je_id INT REFERENCES journal_entries(id),
    created_by INT,
    reversal_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reversed_at TIMESTAMPTZ
);

-- 2. Create performance & uniqueness indexes
CREATE INDEX IF NOT EXISTS idx_btw_pn_id ON bill_tds_withholdings(purchase_note_id);
CREATE INDEX IF NOT EXISTS idx_btw_vendor_id ON bill_tds_withholdings(vendor_id);
CREATE INDEX IF NOT EXISTS idx_btw_status ON bill_tds_withholdings(status);
CREATE INDEX IF NOT EXISTS idx_btw_posting_je ON bill_tds_withholdings(posting_je_id);

-- Enforce at most one active POSTED TDS withholding per Bill
CREATE UNIQUE INDEX IF NOT EXISTS idx_bill_tds_active ON bill_tds_withholdings (purchase_note_id) WHERE status = 'POSTED';

-- 3. Idempotently assign account_role 'TDS_PAYABLE' to Account 3004 if unset
UPDATE accounts
SET account_role = 'TDS_PAYABLE', updated_at = NOW()
WHERE (code = '3004' OR name ILIKE '%tds payable%')
  AND (account_role IS NULL OR account_role = '' OR account_role = 'TDS_PAYABLE');

COMMIT;
