-- Phase 84: TDS Allocation Audit Log
-- Stores archived/neutralized legacy TDS allocations for audit and historical reconciliation tracking.

CREATE TABLE IF NOT EXISTS tds_allocation_audit_log (
  id                     SERIAL PRIMARY KEY,
  original_alloc_id      INTEGER UNIQUE NOT NULL,
  bill_id                INTEGER,
  vendor_id              INTEGER,
  je_id                  INTEGER NOT NULL,
  target_id              INTEGER NOT NULL,
  allocated_amount       NUMERIC(15,2) NOT NULL,
  original_notes         TEXT,
  original_row           JSONB NOT NULL,
  reconciliation_run_id  UUID NOT NULL,
  neutralized_by         TEXT NOT NULL DEFAULT 'SYSTEM_RECONCILIATION',
  neutralized_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason                 TEXT NOT NULL DEFAULT 'LEGACY_TDS_RECONCILIATION'
);

CREATE INDEX IF NOT EXISTS idx_tds_alloc_audit_bill ON tds_allocation_audit_log(bill_id);
CREATE INDEX IF NOT EXISTS idx_tds_alloc_audit_je   ON tds_allocation_audit_log(je_id);
