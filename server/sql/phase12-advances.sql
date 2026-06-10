-- ============================================================
-- Phase 12: Vendor & Customer Advance Tracking
-- Run AFTER phase11-sub-type.sql
-- ============================================================

-- Add advance_amount column to payments (overpayment over bills)
ALTER TABLE payments ADD COLUMN IF NOT EXISTS advance_amount NUMERIC(15,2) DEFAULT 0;

-- Add advance_amount column to receipts (overpayment over invoices)
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS advance_amount NUMERIC(15,2) DEFAULT 0;

-- ============================================================
-- VENDOR ADVANCES
-- Created whenever a payment exceeds the linked bill amounts
-- ============================================================
CREATE TABLE IF NOT EXISTS vendor_advances (
  id               SERIAL PRIMARY KEY,
  vendor_id        INTEGER NOT NULL REFERENCES vendors(id),
  payment_id       INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  amount           NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  remaining_amount NUMERIC(15,2) NOT NULL,
  status           VARCHAR(20) DEFAULT 'OPEN',  -- OPEN, APPLIED, CANCELLED
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vadv_vendor ON vendor_advances(vendor_id, status);

-- ============================================================
-- CUSTOMER ADVANCES
-- Created whenever a receipt exceeds the linked invoice amounts
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_advances (
  id               SERIAL PRIMARY KEY,
  customer_id      INTEGER NOT NULL REFERENCES customers(id),
  receipt_id       INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  amount           NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  remaining_amount NUMERIC(15,2) NOT NULL,
  status           VARCHAR(20) DEFAULT 'OPEN',  -- OPEN, APPLIED, CANCELLED
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cadv_customer ON customer_advances(customer_id, status);

-- ============================================================
-- SYSTEM GL ACCOUNTS FOR ADVANCES
-- ============================================================

-- Vendor Advance Paid (Asset: we pre-paid vendor, they owe us goods/services)
INSERT INTO accounts (code, name, type, sub_type, is_group, currency, status, description)
VALUES ('1050', 'Vendor Advance (Prepaid)', 'asset', 'other', false, 'INR', 'active',
        'Advance payments made to vendors, to be adjusted against future bills')
ON CONFLICT (code) DO NOTHING;

-- Customer Advance Received (Liability: customer pre-paid us, we owe them goods/services)
INSERT INTO accounts (code, name, type, sub_type, is_group, currency, status, description)
VALUES ('2050', 'Customer Advance Received', 'liability', 'other', false, 'INR', 'active',
        'Advance receipts from customers, to be adjusted against future invoices')
ON CONFLICT (code) DO NOTHING;
