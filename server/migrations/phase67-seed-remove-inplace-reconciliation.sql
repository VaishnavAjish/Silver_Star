-- ============================================================
-- Phase 67 — Seed Remove in-place identity reconciliation (DESIGN ONLY)
-- ============================================================
-- DO NOT AUTO-RUN. DO NOT APPLY in this task. Guarded one-time repair for the
-- ALREADY-POSTED incorrect Seed Remove transaction (GR-202607-0044 / R1) that
-- ran through the legacy consume-and-create-two-children path.
--
--   Goal state:
--     · 100559 becomes the canonical Growth Diamond   (transformed in place)
--     · 100558 becomes the canonical recovered Seed    (released in place)
--     · 100696 (GR-202607-0044-R1) safely retired/voided
--     · 100697 (GR-202607-0044-S1) safely retired/voided
--     · no duplicate stock, no duplicate value, history explains the correction
--
-- SAFETY DOCTRINE (this script aborts rather than guess):
--   1. All four exact inventory IDs must match the expected transaction.
--   2. Generated rows 100696 / 100697 must have NO downstream operational use.
--      If any reference exists -> RAISE 'BLOCKED - GENERATED INVENTORY ALREADY USED'.
--   3. Value is MOVED from the generated rows onto the reused identities
--      (conservation), never duplicated, never reset to an unproven number.
--   4. No blind DELETE of historical records - generated rows are ARCHIVED
--      (repository void semantics), qty/value zeroed, with an audit note.
--
-- Apply (only after a DB-connected reviewer confirms the read-only audit):
--   psql "$DATABASE_URL" -f phase67-seed-remove-inplace-reconciliation.sql
--
-- Pre-check (read-only - run and keep the output for rollback reference):
--   SELECT id, item_id, lot_number, lot_code, root_lot_id, status, qty, weight,
--          rate, total_value, dim_length, dim_depth, dim_height, dim_unit,
--          manufacturing_state
--   FROM inventory WHERE id IN (100559,100558,100696,100697);

BEGIN;
SET LOCAL lock_timeout = '5000ms';
SET LOCAL statement_timeout = '60000ms';

DO $$
DECLARE
  v_carrier   inventory%ROWTYPE;   -- 100559 Growth carrier (GR-202607-0044)
  v_seed      inventory%ROWTYPE;   -- 100558 attached Seed  (1162-01)
  v_gen_gd    inventory%ROWTYPE;   -- 100696 generated Growth Diamond (-R1)
  v_gen_seed  inventory%ROWTYPE;   -- 100697 generated recovered Seed (-S1)
  v_gd_item   integer;
  v_refs      integer := 0;
BEGIN
  -- Lock the four rows in deterministic id order.
  SELECT * INTO v_seed     FROM inventory WHERE id = 100558 FOR UPDATE;
  SELECT * INTO v_carrier  FROM inventory WHERE id = 100559 FOR UPDATE;
  SELECT * INTO v_gen_gd   FROM inventory WHERE id = 100696 FOR UPDATE;
  SELECT * INTO v_gen_seed FROM inventory WHERE id = 100697 FOR UPDATE;

  -- (1) Identity guards - abort on any mismatch.
  IF v_carrier.id IS NULL OR v_carrier.lot_number <> 'GR-202607-0044' THEN
    RAISE EXCEPTION 'phase67: carrier 100559 missing or not GR-202607-0044 - aborting';
  END IF;
  IF v_seed.id IS NULL OR v_seed.lot_number <> '1162-01' THEN
    RAISE EXCEPTION 'phase67: attached Seed 100558 missing or not 1162-01 - aborting';
  END IF;
  IF v_gen_gd.id IS NULL OR v_gen_gd.lot_number <> 'GR-202607-0044-R1' THEN
    RAISE EXCEPTION 'phase67: generated Growth 100696 missing or not GR-202607-0044-R1 - aborting';
  END IF;
  IF v_gen_seed.id IS NULL OR v_gen_seed.lot_number <> 'GR-202607-0044-S1' THEN
    RAISE EXCEPTION 'phase67: generated Seed 100697 missing or not GR-202607-0044-S1 - aborting';
  END IF;

  -- (2) Downstream-use guard on the generated rows. ANY reference blocks.
  --     Probe every table that resolves inventory by id (skip absent tables).
  IF to_regclass('lot_process_issues') IS NOT NULL THEN
    SELECT v_refs
         + (SELECT count(*) FROM lot_process_issues
             WHERE source_lot_id IN (100696,100697) OR process_lot_id IN (100696,100697))
      INTO v_refs;
  END IF;
  IF to_regclass('process_return_lines') IS NOT NULL THEN
    SELECT v_refs + (SELECT count(*) FROM process_return_lines WHERE lot_id IN (100696,100697)) INTO v_refs;
  END IF;
  IF to_regclass('machine_process_lots') IS NOT NULL THEN
    SELECT v_refs + (SELECT count(*) FROM machine_process_lots WHERE inventory_lot_id IN (100696,100697)) INTO v_refs;
  END IF;
  IF to_regclass('rough_growth_lines') IS NOT NULL THEN
    SELECT v_refs + (SELECT count(*) FROM rough_growth_lines WHERE inventory_id IN (100696,100697)) INTO v_refs;
  END IF;
  -- Genealogy children of the generated rows.
  SELECT v_refs + (SELECT count(*) FROM inventory
                   WHERE parent_lot_id IN (100696,100697) OR root_lot_id IN (100696,100697)) INTO v_refs;

  IF v_refs > 0 THEN
    RAISE EXCEPTION 'BLOCKED - GENERATED INVENTORY ALREADY USED: % downstream reference(s) to 100696/100697 - refusing destructive repair', v_refs;
  END IF;

  -- Canonical Growth Diamond item.
  SELECT id INTO v_gd_item FROM items WHERE category = 'growth_diamond' ORDER BY id LIMIT 1;
  IF v_gd_item IS NULL THEN
    RAISE EXCEPTION 'phase67: canonical growth_diamond item not found - aborting';
  END IF;

  -- (3) Carrier 100559 -> canonical Growth Diamond (adopt the measured values
  --     captured on the generated row; MOVE its value here - no duplication).
  UPDATE inventory
     SET item_id = v_gd_item,
         status  = 'IN STOCK',
         qty     = 24,                          -- actual Growth-family quantity
         unit    = v_carrier.unit,              -- canonical PCS unit preserved
         weight  = v_gen_gd.weight,             -- 298.5600 ct measured
         dim_length = v_gen_gd.dim_length,
         dim_depth  = v_gen_gd.dim_depth,
         dim_height = v_gen_gd.dim_height,
         dim_unit   = COALESCE(v_gen_gd.dim_unit, v_carrier.dim_unit),
         total_value = v_gen_gd.total_value,    -- value moved off 100696
         rate    = CASE WHEN 24 > 0 THEN round(v_gen_gd.total_value / 24, 4) ELSE v_carrier.rate END,
         manufacturing_state = 'AVAILABLE',
         updated_at = NOW()
   WHERE id = 100559;

  -- Seed 100558 -> canonical recovered Seed (released in place; root preserved).
  UPDATE inventory
     SET status = 'IN STOCK',
         qty    = 24,
         weight = v_gen_seed.weight,            -- 23.5200 ct
         dim_length = COALESCE(v_gen_seed.dim_length, v_seed.dim_length),
         dim_depth  = COALESCE(v_gen_seed.dim_depth,  v_seed.dim_depth),
         dim_height = COALESCE(v_gen_seed.dim_height, v_seed.dim_height),
         dim_unit   = COALESCE(v_gen_seed.dim_unit,   v_seed.dim_unit),
         total_value = v_gen_seed.total_value,  -- value moved off 100697
         rate   = CASE WHEN 24 > 0 THEN round(v_gen_seed.total_value / 24, 4) ELSE v_seed.rate END,
         manufacturing_state = 'AVAILABLE',
         updated_at = NOW()
   WHERE id = 100558;

  -- (4) Retire the generated rows (ARCHIVED void; qty/value zeroed - no delete).
  UPDATE inventory
     SET status = 'ARCHIVED', qty = 0, weight = 0, total_value = 0,
         manufacturing_state = 'RETIRED', updated_at = NOW()
   WHERE id IN (100696, 100697);

  -- Audit trail (value moved, identities reconciled).
  INSERT INTO lot_op_log (lot_id, operation, reference_type, reference_id, qty_delta, new_status, notes, performed_by)
  VALUES
    (100559, 'seed_remove_reconcile', 'inventory', 100696, 24, 'IN STOCK',
     'phase67: carrier GR-202607-0044 reconciled to canonical Growth Diamond in place; value/measures adopted from voided 100696', NULL),
    (100558, 'seed_remove_reconcile', 'inventory', 100697, 24, 'IN STOCK',
     'phase67: attached Seed 1162-01 released in place; value/measures adopted from voided 100697; root 1162 preserved', NULL),
    (100696, 'seed_remove_void', 'inventory', 100559, 0, 'ARCHIVED',
     'phase67: generated -R1 voided; identity/value folded into carrier 100559', NULL),
    (100697, 'seed_remove_void', 'inventory', 100558, 0, 'ARCHIVED',
     'phase67: generated -S1 voided; identity/value folded into attached Seed 100558', NULL);

  RAISE NOTICE 'phase67: reconciliation complete - 100559=Growth Diamond, 100558=recovered Seed, 100696/100697 voided';
END $$;

COMMIT;

-- Post-check (manual):
--   SELECT id, lot_number, status, qty, weight, total_value, manufacturing_state
--   FROM inventory WHERE id IN (100559,100558,100696,100697);
-- Expect: 100559 IN STOCK growth_diamond qty 24 / 298.5600; 100558 IN STOCK seed
-- qty 24 / 23.5200; 100696 & 100697 ARCHIVED qty 0 value 0. Total value unchanged.
