-- ============================================================
-- Phase 62: Seed Lifecycle Phase A — Manufacturing State
-- ============================================================
-- DO NOT AUTO-RUN. Apply manually on EC2:
--   psql $DATABASE_URL -f phase62-manufacturing-state.sql
--
-- Two-state architecture (approved): Inventory Status keeps controlling ERP
-- workflow (IN STOCK / IN PROCESS / DAMAGED / CONSUMED / SCRAPPED);
-- manufacturing_state describes the PHYSICAL manufacturing condition.
--
--   AVAILABLE           — normal stock (legacy rows: NULL means AVAILABLE)
--   ATTACHED_TO_GROWTH  — the issued Seed process lot physically embedded in
--                         an active Partial Growth Run (until Seed Remove)
--   RECOVERED           — Seed recovered by Seed Remove (Phase C)
--   RETIRED             — identity retired from manufacturing (Phase C)
--
-- NO destructive backfill: legacy rows stay NULL and are read as AVAILABLE.
--
-- DEPLOY COUPLING: apply BEFORE (or together with) the Phase A code deploy —
-- the issue flow WRITES this column for GROWTH-group issues; readers use
-- SELECT inv.* and are deploy-safe either way.

BEGIN;

ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS manufacturing_state VARCHAR(30);

-- Guarded, idempotent CHECK constraint (same pattern as phase34).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_inventory_manufacturing_state'
  ) THEN
    ALTER TABLE inventory
      ADD CONSTRAINT chk_inventory_manufacturing_state
      CHECK (manufacturing_state IS NULL OR manufacturing_state IN
             ('AVAILABLE','ATTACHED_TO_GROWTH','RECOVERED','RETIRED'));
  END IF;
END $$;

-- Partial index: only non-NULL states are ever filtered on.
CREATE INDEX IF NOT EXISTS idx_inventory_manufacturing_state
  ON inventory (manufacturing_state)
  WHERE manufacturing_state IS NOT NULL;

COMMIT;

-- Verification:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='inventory' AND column_name='manufacturing_state';
--
-- Rollback (safe — column is additive and unread by legacy code):
--   ALTER TABLE inventory DROP CONSTRAINT IF EXISTS chk_inventory_manufacturing_state;
--   DROP INDEX IF EXISTS idx_inventory_manufacturing_state;
--   ALTER TABLE inventory DROP COLUMN IF EXISTS manufacturing_state;
