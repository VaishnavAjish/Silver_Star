-- ============================================================
-- Phase 89 ROLLBACK — Legacy Seed Reconstruction business identity
-- ============================================================
-- DO NOT AUTO-RUN. Reverses phase89-legacy-seed-reconstruction-identity.sql.
--
-- SAFETY: aborts if any reconstruction row exists — dropping the column would
-- destroy the business linkage of a committed repair. Reconcile those rows
-- first (or accept the loss explicitly by removing this guard).

BEGIN;

DO $$
DECLARE
  n integer;
BEGIN
  SELECT count(*) INTO n FROM inventory WHERE reconstructed_for_issue_id IS NOT NULL;
  IF n > 0 THEN
    RAISE EXCEPTION 'phase89 rollback blocked: % reconstructed Seed row(s) reference an issue — reconcile first', n;
  END IF;
END $$;

DROP INDEX IF EXISTS uq_inventory_legacy_reconstruction_issue;

ALTER TABLE inventory
  DROP COLUMN IF EXISTS reconstructed_for_issue_id;

COMMIT;
