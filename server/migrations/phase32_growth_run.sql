-- ============================================================
-- Phase 32: Growth Run / Biscuit as Inventory
-- ------------------------------------------------------------
-- Adopts Option C from the Phase 32 Design Validation Audit:
--   * machine_processes  = runtime / lifecycle  (unchanged)
--   * inventory(category='growth_run') = physical biscuit (NEW)
--   * rough_growth       = costing / output document (parent shifts to biscuit)
--
-- Run ORDER:
--   1. ALTER TYPE statement (must run OUTSIDE a transaction).
--   2. Remaining DDL/DML in a single BEGIN/COMMIT block.
--
-- Safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING guards).
-- ============================================================

-- ── 1. Extend item_category enum ─────────────────────────────────────────────
-- Must execute outside any BEGIN/COMMIT block (Postgres enum ALTER rule).
ALTER TYPE item_category ADD VALUE IF NOT EXISTS 'growth_run';

-- ── Remaining DDL/DML in one transaction ─────────────────────────────────────
BEGIN;

-- ── 2. Growth Run number sequence (GR-000001, GR-000002, ...) ────────────────
CREATE SEQUENCE IF NOT EXISTS growth_run_seq START 1;

-- ── 3. New columns on inventory (growth-run specific, all nullable) ──────────
-- Snapshots captured at the moment the biscuit row is created (before run completes).
-- Reuses existing dim_height / dim_length / dim_depth (Phase 25) for FINAL measurements.
ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS machine_process_id   INTEGER REFERENCES machine_processes(id),
  ADD COLUMN IF NOT EXISTS seed_height_at_in    NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS weight_at_in         NUMERIC(12,4);

-- ── 4. Generated columns: actual_growth_mm, weight_gain, growth_pct ──────────
-- STORED generated columns: maintained automatically, indexable, queryable.
-- Null-safe: NULL inputs yield NULL outputs (no division-by-zero risk).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory' AND column_name = 'actual_growth_mm'
  ) THEN
    ALTER TABLE inventory
      ADD COLUMN actual_growth_mm NUMERIC(10,3)
        GENERATED ALWAYS AS (
          CASE WHEN dim_height IS NOT NULL AND seed_height_at_in IS NOT NULL
               THEN dim_height - seed_height_at_in END
        ) STORED;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory' AND column_name = 'weight_gain'
  ) THEN
    ALTER TABLE inventory
      ADD COLUMN weight_gain NUMERIC(12,4)
        GENERATED ALWAYS AS (
          CASE WHEN weight IS NOT NULL AND weight_at_in IS NOT NULL
               THEN weight - weight_at_in END
        ) STORED;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory' AND column_name = 'growth_pct'
  ) THEN
    ALTER TABLE inventory
      ADD COLUMN growth_pct NUMERIC(8,2)
        GENERATED ALWAYS AS (
          CASE WHEN dim_height IS NOT NULL
                AND seed_height_at_in IS NOT NULL
                AND seed_height_at_in > 0
               THEN ROUND(((dim_height - seed_height_at_in) / seed_height_at_in) * 100, 2) END
        ) STORED;
  END IF;
END $$;

-- ── 5. Validation: non-negative snapshots ────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_seed_height_at_in_nonneg' AND conrelid = 'inventory'::regclass
  ) THEN
    ALTER TABLE inventory
      ADD CONSTRAINT inventory_seed_height_at_in_nonneg
        CHECK (seed_height_at_in IS NULL OR seed_height_at_in >= 0),
      ADD CONSTRAINT inventory_weight_at_in_nonneg
        CHECK (weight_at_in IS NULL OR weight_at_in >= 0);
  END IF;
END $$;

-- ── 6. Indexes (sparse — only populated for biscuit rows) ────────────────────
CREATE INDEX IF NOT EXISTS idx_inventory_machine_process
  ON inventory(machine_process_id)
  WHERE machine_process_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_growth_metrics
  ON inventory(growth_pct)
  WHERE growth_pct IS NOT NULL;

-- ── 7. Master Item row for category='growth_run' (one per category pattern) ──
INSERT INTO items (code, name, category, type, default_uom, description, status)
VALUES ('BISCUIT', 'CVD Growth Run (Biscuit)', 'growth_run', 'finished_good', 'PCS',
        'Physical biscuit produced by a CVD growth process. One row per biscuit.', 'active')
ON CONFLICT (code) DO NOTHING;

-- ── 8. process_master rows for laser sub-processes ───────────────────────────
-- Each consumes a Growth Run biscuit (source_lot) and produces ROUGH lots.
-- completion_mode = OUTPUT_BASED (output must be posted before process closes).
INSERT INTO process_master
  (process_code, process_name, category,
   requires_inventory, requires_machine, requires_operator,
   requires_runtime, requires_expected_yield, allows_consumables,
   output_type, default_runtime_hours, sort_order, completion_mode)
VALUES
  ('edge_cut',    'Edge Cut',    'PRIMARY', true, true, true, true, true, false, 'ROUGH', 1.0,  51, 'OUTPUT_BASED'),
  ('outer_cut',   'Outer Cut',   'PRIMARY', true, true, true, true, true, false, 'ROUGH', 1.0,  52, 'OUTPUT_BASED'),
  ('block_cut',   'Block Cut',   'PRIMARY', true, true, true, true, true, false, 'ROUGH', 1.5,  53, 'OUTPUT_BASED'),
  ('seed_remove', 'Seed Remove', 'PRIMARY', true, true, true, true, false, false, 'ROUGH', 0.5,  54, 'OUTPUT_BASED'),
  ('growth_cut',  'Growth Cut',  'PRIMARY', true, true, true, true, true, false, 'ROUGH', 2.0,  55, 'OUTPUT_BASED')
ON CONFLICT (process_code) DO NOTHING;

COMMIT;

-- ── Validation queries ────────────────────────────────────────────────────────
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'item_category'::regtype AND enumlabel = 'growth_run'
  ) THEN 'OK — growth_run added to item_category enum'
  ELSE 'FAIL — growth_run missing from item_category enum'
  END AS enum_check,

  CASE WHEN EXISTS (SELECT 1 FROM items WHERE category = 'growth_run' AND code = 'BISCUIT')
    THEN 'OK — BISCUIT item seeded'
    ELSE 'FAIL — BISCUIT item not seeded'
  END AS item_check,

  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory' AND column_name = 'actual_growth_mm'
  ) THEN 'OK — growth metric generated columns present'
  ELSE 'FAIL — generated columns missing'
  END AS metrics_check,

  CASE WHEN (SELECT COUNT(*) FROM process_master
              WHERE process_code IN ('edge_cut','outer_cut','block_cut','seed_remove','growth_cut')) = 5
    THEN 'OK — 5 laser sub-processes seeded'
    ELSE 'FAIL — laser sub-processes missing'
  END AS sub_process_check;
