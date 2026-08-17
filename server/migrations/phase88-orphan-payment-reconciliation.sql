-- ============================================================
-- PHASE 88 — ACCOUNTING PHASE 1A
-- Historical Orphan Payment Reconciliation (schema only)
--
-- Adds reversal-awareness to payment_allocations so allocation
-- history can be preserved (never DELETEd) when a historical
-- orphan payment (payments.je_id → missing journal_entries row)
-- is reconciled, plus a durable audit table for the repair.
--
-- SAFETY
--   * Purely additive. No existing row is modified: the new
--     status column defaults every existing allocation to
--     'ACTIVE', which is exactly today's implicit semantics.
--   * Does NOT touch payments, purchase_notes, journal_entries,
--     je_lines or accounts.
--   * Does NOT reference or repair PAY-1179 / PAY-1240. The
--     repair itself is a separately-invoked, human-approved
--     script (scripts/reconcileOrphanedPayment.js).
--
-- Rollback: phase88-orphan-payment-reconciliation.rollback.sql
-- ============================================================

-- ── 1. Allocation reversal state ─────────────────────────────
ALTER TABLE payment_allocations
  ADD COLUMN IF NOT EXISTS status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS reversed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by     INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

-- ACTIVE   = contributes economically (today's behaviour)
-- REVERSED = historical evidence only; excluded from every
--            settlement / AP / vendor-ledger aggregate
DO $$ BEGIN
  ALTER TABLE payment_allocations
    ADD CONSTRAINT chk_palloc_status CHECK (status IN ('ACTIVE', 'REVERSED'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Fast path for the canonical active-allocation predicate
CREATE INDEX IF NOT EXISTS idx_palloc_pn_active
  ON payment_allocations (purchase_note_id)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_palloc_payment_status
  ON payment_allocations (payment_id, status);

-- ── 2. Durable reconciliation audit ──────────────────────────
CREATE TABLE IF NOT EXISTS orphan_payment_reconciliation_audit (
  id                     SERIAL PRIMARY KEY,
  run_id                 UUID NOT NULL,
  operation_type         TEXT NOT NULL
                           DEFAULT 'HISTORICAL_ORPHAN_PAYMENT_RECONCILIATION',
  payment_id             INTEGER NOT NULL REFERENCES payments(id),
  payment_reference      VARCHAR(50) NOT NULL,
  vendor_id              INTEGER,
  vendor_name            TEXT,
  amount                 NUMERIC(15,2) NOT NULL,
  missing_je_id          INTEGER NOT NULL,
  reason                 TEXT NOT NULL,
  actor_id               INTEGER REFERENCES users(id),
  payment_status_before  VARCHAR(20) NOT NULL,
  payment_status_after   VARCHAR(20) NOT NULL,
  allocation_ids         INTEGER[] NOT NULL DEFAULT '{}',
  bill_ids               INTEGER[] NOT NULL DEFAULT '{}',
  -- [{bill_id, doc_number, before_paid, after_paid, before_due,
  --   after_due, before_status, after_status}]
  bill_effects           JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{advance_id, before_status, before_remaining, after_status,
  --   after_remaining}]
  advance_effects        JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Hard invariant of Phase 1A: this repair NEVER touches the GL.
  gl_mutation_performed  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One applied repair per payment, ever (idempotency backstop).
CREATE UNIQUE INDEX IF NOT EXISTS uq_orphan_recon_payment
  ON orphan_payment_reconciliation_audit (payment_id);

CREATE INDEX IF NOT EXISTS idx_orphan_recon_run
  ON orphan_payment_reconciliation_audit (run_id);
