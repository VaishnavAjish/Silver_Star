-- ============================================================
-- Phase 34: Process Group routing (GROWTH / LASER)
-- ------------------------------------------------------------
-- Adds a routing dimension to process_master so the SINGLE Start Process
-- screen can decide, purely from master data (no hardcoded UI rules):
--   * which inventory category is a valid input   (input_item_category)
--   * which machine type is eligible              (eligible_machine_type)
--   * which behavioural group the process belongs  (process_group)
--
--   GROWTH : seed input  → CVD reactor → auto-creates a Growth Run (biscuit)
--   LASER  : growth_run  → laser        → operates ON the biscuit (no consume)
--
-- Genealogy spine is unchanged:  Seed → Growth Run → Rough.
-- Additive only. Safe to re-run (IF NOT EXISTS / guarded backfill).
-- Run ONCE: psql $DATABASE_URL -f phase34_process_group.sql
-- ============================================================

BEGIN;

-- ── 1. New configuration columns on process_master ───────────────────────────
ALTER TABLE process_master
  ADD COLUMN IF NOT EXISTS process_group         VARCHAR(20),
  ADD COLUMN IF NOT EXISTS input_item_category   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS eligible_machine_type VARCHAR(30);

-- ── 2. Constrain process_group to a forward-scalable set ─────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'process_master_group_valid'
      AND conrelid = 'process_master'::regclass
  ) THEN
    ALTER TABLE process_master
      ADD CONSTRAINT process_master_group_valid
        CHECK (process_group IS NULL OR process_group IN
               ('GROWTH','LASER','POLISHING','QC','PACKING','OTHER'));
  END IF;
END $$;

-- ── 3. Backfill GROWTH ───────────────────────────────────────────────────────
-- Growth: seeds in, CVD reactor, produces the biscuit.
UPDATE process_master
   SET process_group         = 'GROWTH',
       input_item_category   = 'seed',
       eligible_machine_type = 'CVD'
 WHERE process_code = 'growth';

-- ── 4. Backfill LASER (the 5 laser sub-processes seeded in Phase 32) ─────────
-- Laser ops run ON an existing Growth Run; runtime is optional for them.
-- They do NOT create rough — rough is created ONLY at Growth Output (Phase 33).
-- So a laser process simply issues the biscuit, performs its cut, returns the
-- biscuit and completes:  completion_mode = RETURN_BASED, output_type = NONE.
-- (They were seeded OUTPUT_BASED/ROUGH in Phase 32, which would have demanded a
-- separate rough output per laser — a parallel rough path we explicitly avoid.)
UPDATE process_master
   SET process_group         = 'LASER',
       input_item_category   = 'growth_run',
       eligible_machine_type = 'LASER',
       requires_runtime      = false,
       requires_expected_yield = false,
       completion_mode       = 'RETURN_BASED',
       output_type           = 'NONE'
 WHERE process_code IN ('edge_cut','outer_cut','block_cut','seed_remove','growth_cut');

-- ── 5. Everything else → OTHER (no input/machine restriction) ─────────────────
UPDATE process_master
   SET process_group = 'OTHER'
 WHERE process_group IS NULL;

COMMIT;

-- ── Validation ────────────────────────────────────────────────────────────────
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'process_master' AND column_name = 'process_group'
  ) THEN 'OK — process_group column present'
  ELSE 'FAIL — process_group column missing' END AS column_check,

  CASE WHEN (SELECT process_group FROM process_master WHERE process_code = 'growth') = 'GROWTH'
    THEN 'OK — growth → GROWTH'
    ELSE 'FAIL — growth not classified' END AS growth_check,

  CASE WHEN (SELECT COUNT(*) FROM process_master
              WHERE process_group = 'LASER'
                AND process_code IN ('edge_cut','outer_cut','block_cut','seed_remove','growth_cut')) = 5
    THEN 'OK — 5 laser processes → LASER'
    ELSE 'FAIL — laser processes not classified' END AS laser_check;

-- Quick map for the record:
SELECT process_code, process_name, process_group, input_item_category,
       eligible_machine_type, requires_runtime
FROM   process_master
ORDER  BY sort_order, process_name;
