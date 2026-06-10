-- ============================================================
-- SILVERSTAR GROW - Phase 7: Fixed Asset GST Tracking
-- Run AFTER phase4-fixed-assets.sql
-- ============================================================

ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS invoice_no                 VARCHAR(50),
  ADD COLUMN IF NOT EXISTS invoice_date               DATE,
  ADD COLUMN IF NOT EXISTS taxable_value              NUMERIC(15,2) DEFAULT 0 CHECK (taxable_value >= 0),
  ADD COLUMN IF NOT EXISTS gst_rate                   NUMERIC(5,2) DEFAULT 0 CHECK (gst_rate >= 0),
  ADD COLUMN IF NOT EXISTS cgst_amount                NUMERIC(15,2) DEFAULT 0 CHECK (cgst_amount >= 0),
  ADD COLUMN IF NOT EXISTS sgst_amount                NUMERIC(15,2) DEFAULT 0 CHECK (sgst_amount >= 0),
  ADD COLUMN IF NOT EXISTS igst_amount                NUMERIC(15,2) DEFAULT 0 CHECK (igst_amount >= 0),
  ADD COLUMN IF NOT EXISTS gst_claimable_amount       NUMERIC(15,2) DEFAULT 0 CHECK (gst_claimable_amount >= 0),
  ADD COLUMN IF NOT EXISTS gst_non_claimable_amount   NUMERIC(15,2) DEFAULT 0 CHECK (gst_non_claimable_amount >= 0),
  ADD COLUMN IF NOT EXISTS gst_treatment              VARCHAR(20) DEFAULT 'non_claimable'
    CHECK (gst_treatment IN ('claimable','non_claimable','partial')),
  ADD COLUMN IF NOT EXISTS total_invoice_value        NUMERIC(15,2) DEFAULT 0 CHECK (total_invoice_value >= 0);

CREATE TABLE IF NOT EXISTS fixed_asset_gst_ledger (
  id                         SERIAL PRIMARY KEY,
  fixed_asset_id             INTEGER NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  vendor_id                  INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  invoice_no                 VARCHAR(50),
  invoice_date               DATE,
  taxable_value              NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (taxable_value >= 0),
  cgst_amount                NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (cgst_amount >= 0),
  sgst_amount                NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (sgst_amount >= 0),
  igst_amount                NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (igst_amount >= 0),
  gst_claimable_amount       NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (gst_claimable_amount >= 0),
  gst_non_claimable_amount   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (gst_non_claimable_amount >= 0),
  total_invoice_value        NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_invoice_value >= 0),
  treatment                  VARCHAR(20) NOT NULL DEFAULT 'non_claimable'
    CHECK (treatment IN ('claimable','non_claimable','partial')),
  remarks                    TEXT,
  created_at                 TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fa_gst_asset ON fixed_asset_gst_ledger(fixed_asset_id);
CREATE INDEX IF NOT EXISTS idx_fa_gst_invoice_date ON fixed_asset_gst_ledger(invoice_date);
