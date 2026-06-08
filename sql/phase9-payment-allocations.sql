-- ============================================================
-- SILVERSTAR GROW — Phase 9: Payment & Receipt Allocations
-- Run AFTER all previous migrations (schema.sql through phase8)
-- ============================================================

-- Add payment tracking columns to purchase_notes
ALTER TABLE purchase_notes
  ADD COLUMN IF NOT EXISTS amount_paid    NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_due    NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20)   DEFAULT 'UNPAID';

-- Initialize balance_due for all existing purchase notes
UPDATE purchase_notes
SET balance_due    = grand_total,
    amount_paid    = 0,
    payment_status = CASE WHEN grand_total > 0 THEN 'UNPAID' ELSE 'PAID' END
WHERE payment_status IS NULL OR payment_status = 'UNPAID';

-- Index for fast open-bill lookups
CREATE INDEX IF NOT EXISTS idx_pn_vendor_pstatus ON purchase_notes(vendor_id, payment_status);

-- ============================================================
-- PAYMENT ALLOCATIONS
-- One payment can be applied across multiple purchase notes
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_allocations (
  id               SERIAL PRIMARY KEY,
  payment_id       INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  purchase_note_id INTEGER NOT NULL REFERENCES purchase_notes(id),
  amount           NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_palloc_payment ON payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS idx_palloc_pn      ON payment_allocations(purchase_note_id);

-- ============================================================
-- RECEIPT ALLOCATIONS
-- One receipt can be applied across multiple invoices
-- ============================================================
CREATE TABLE IF NOT EXISTS receipt_allocations (
  id         SERIAL PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  amount     NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ralloc_receipt ON receipt_allocations(receipt_id);
CREATE INDEX IF NOT EXISTS idx_ralloc_invoice ON receipt_allocations(invoice_id);
