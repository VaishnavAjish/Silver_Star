-- ============================================================
-- PHASE 88 ROLLBACK — Historical Orphan Payment Reconciliation
--
-- ⚠ Run ONLY if no reconciliation has been APPLIED.
--   The guard below aborts the rollback if either
--   orphan_payment_reconciliation_audit has rows or any
--   payment_allocations row is already REVERSED — dropping the
--   columns/table at that point would destroy audit evidence.
-- ============================================================

DO $$
DECLARE
  audit_rows    INTEGER;
  reversed_rows INTEGER;
BEGIN
  SELECT COUNT(*) INTO audit_rows    FROM orphan_payment_reconciliation_audit;
  SELECT COUNT(*) INTO reversed_rows FROM payment_allocations WHERE status = 'REVERSED';
  IF audit_rows > 0 OR reversed_rows > 0 THEN
    RAISE EXCEPTION
      'phase88 rollback refused: % audit row(s), % reversed allocation(s) exist — evidence would be destroyed',
      audit_rows, reversed_rows;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_orphan_recon_run;
DROP INDEX IF EXISTS uq_orphan_recon_payment;
DROP TABLE IF EXISTS orphan_payment_reconciliation_audit;

DROP INDEX IF EXISTS idx_palloc_payment_status;
DROP INDEX IF EXISTS idx_palloc_pn_active;

ALTER TABLE payment_allocations
  DROP CONSTRAINT IF EXISTS chk_palloc_status;

ALTER TABLE payment_allocations
  DROP COLUMN IF EXISTS reversal_reason,
  DROP COLUMN IF EXISTS reversed_by,
  DROP COLUMN IF EXISTS reversed_at,
  DROP COLUMN IF EXISTS status;
