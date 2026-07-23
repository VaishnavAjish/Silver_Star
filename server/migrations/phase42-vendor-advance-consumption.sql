-- ============================================================
-- Phase 42: Vendor Advance Consumption Engine
-- Migration-safe: idempotent (IF NOT EXISTS / guarded UPDATEs).
-- Does NOT touch historical postings, payments, or payment_allocations.
-- ============================================================

-- ── 1. Audit trail: every application of an advance against a bill ───────────
CREATE TABLE IF NOT EXISTS vendor_advance_applications (
  id               SERIAL PRIMARY KEY,
  advance_id       INTEGER NOT NULL,
  purchase_note_id INTEGER NOT NULL REFERENCES purchase_notes(id),
  vendor_id        INTEGER NOT NULL REFERENCES vendors(id),
  amount           NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  je_id            INTEGER REFERENCES journal_entries(id),
  status           VARCHAR(20) NOT NULL DEFAULT 'APPLIED',  -- APPLIED | REVERSED
  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vaa_advance  ON vendor_advance_applications(advance_id);
CREATE INDEX IF NOT EXISTS idx_vaa_pn       ON vendor_advance_applications(purchase_note_id);
CREATE INDEX IF NOT EXISTS idx_vaa_vendor   ON vendor_advance_applications(vendor_id, status);

-- ── 2. Ensure the VENDOR_ADVANCE role is assigned (COA-restructuring safety) ──
-- account_role is UNIQUE; only assign if no account already holds the role.
-- Prefers live code 1301, then seed code 1050, then any "vendor advance" account.
UPDATE accounts SET account_role = 'VENDOR_ADVANCE'
WHERE account_role IS NULL
  AND NOT EXISTS (SELECT 1 FROM accounts WHERE account_role = 'VENDOR_ADVANCE')
  AND id = (
    SELECT id FROM accounts
    WHERE account_role IS NULL
      AND (code IN ('1301','1050') OR name ILIKE '%vendor advance%')
    ORDER BY (code = '1301') DESC, (code = '1050') DESC, id
    LIMIT 1
  );

-- ── 3. Same safety net for CUSTOMER_ADVANCE (symmetry; harmless if unused) ───
UPDATE accounts SET account_role = 'CUSTOMER_ADVANCE'
WHERE account_role IS NULL
  AND NOT EXISTS (SELECT 1 FROM accounts WHERE account_role = 'CUSTOMER_ADVANCE')
  AND id = (
    SELECT id FROM accounts
    WHERE account_role IS NULL
      AND (code = '2050' OR name ILIKE '%customer advance%')
    ORDER BY (code = '2050') DESC, id
    LIMIT 1
  );

-- ── 4. Verification (run manually after migrating) ───────────────────────────
-- SELECT account_role, code, name FROM accounts WHERE account_role = 'VENDOR_ADVANCE';
-- Expect exactly one row (your live vendor-advance GL, e.g. 1301).
