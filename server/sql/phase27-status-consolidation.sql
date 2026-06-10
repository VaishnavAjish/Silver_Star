-- ============================================================
-- SILVERSTAR GROW — Phase 27b: Inventory Status Standardization
-- Run AFTER phase27-inventory-reset.sql (inventory will be empty,
-- but this is idempotent and safe to run on populated tables too).
--
-- Canonical status set (6 values only):
--   IN STOCK   — available for use
--   IN PROCESS — currently in a process cycle
--   CONSUMED   — fully consumed / split-sourced
--   DAMAGED    — physically damaged, unusable
--   SOLD       — transferred via invoice
--   ARCHIVED   — manually retired by operator
--
-- Removed: LOW STOCK (was a quasi-alert stored as status — wrong layer;
--          threshold alerts belong in reporting, not the status field)
--          SPLIT / MIXED (removed in phase23; migrated to CONSUMED)
-- ============================================================

BEGIN;

-- ── Migrate any surviving LOW STOCK rows → IN STOCK ──────────
-- (These should be 0 after phase27-inventory-reset, but defensive.)
UPDATE inventory
   SET status     = 'IN STOCK',
       updated_at = NOW()
 WHERE status = 'LOW STOCK';

-- ── Enforce canonical status via CHECK constraint ─────────────
-- Idempotent: skips if constraint already exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname    = 'inventory_status_valid'
       AND conrelid   = 'inventory'::regclass
  ) THEN
    ALTER TABLE inventory
      ADD CONSTRAINT inventory_status_valid
      CHECK (status IN (
        'IN STOCK', 'IN PROCESS', 'CONSUMED',
        'DAMAGED', 'SOLD', 'ARCHIVED'
      ));
  END IF;
END $$;

COMMIT;

-- ── Verification ──────────────────────────────────────────────
-- Confirm constraint exists:
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conname = 'inventory_status_valid';

-- Confirm no disallowed statuses remain (should return 0 rows):
SELECT status, COUNT(*) AS cnt
  FROM inventory
 WHERE status NOT IN ('IN STOCK','IN PROCESS','CONSUMED','DAMAGED','SOLD','ARCHIVED')
 GROUP BY status;
