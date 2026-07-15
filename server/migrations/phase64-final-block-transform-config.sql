-- Phase 64 — Final Block: Growth Diamond → Rough Diamond in-place transform
-- CONFIGURATION migration (data-only; no schema change). DO NOT auto-apply —
-- run manually on EC2, strictly AFTER phase63-reconcile-legacy-processes.sql.
--
-- Target: the single canonical Final Block process that phase63 establishes
-- by renaming pr-06 → 'final_block'. This migration configures ONLY that row.
-- It never guesses at block_cut / pr-06 / growth_cut and never creates a row.
--
-- SAFETY (no silent no-op): before configuring, this migration verifies
--   · exactly one process_master row with process_code = 'final_block', and
--   · zero rows with process_code = 'pr-06'.
-- If either expectation fails it RAISES and the transaction ROLLS BACK — it
-- will not silently update zero rows. After the UPDATE it asserts exactly one
-- row was configured. Re-running with the correct configuration already in
-- place is an idempotent success (still exactly one final_block row updated).
--
-- Engine semantics activated by this configuration
-- (services/returnRouting.js + routes/lotProcessIssues.js):
--   · usable return line → TRANSFORM_IN_PLACE: the SAME inventory row keeps
--     its id, lot number, Growth Number lineage, root and genealogy; only
--     item category (growth_diamond → rough), operator-measured weight and
--     dimensions change; status → IN STOCK; carrying value preserved.
--   · full remaining quantity only; single usable line; measured output
--     weight mandatory and ≤ input weight (loss-only process).
--   · issue path only accepts growth_diamond inputs for this process.
--   · non-reversible (FINAL_BLOCK snapshot, reversal_supported:false).
--   · damaged / consumed dispositions keep legacy CHILD behaviour.
--
-- completion_mode is set to RETURN_BASED: the in-place transformation IS the
-- terminal output of this process — there is no separate Growth-Output-style
-- posting afterwards, so the machine must not wait in awaiting_output.
-- Activation is driven purely by the transform_in_place output rule below,
-- never by the literal process code.

BEGIN;

DO $$
DECLARE
  v_final_count INTEGER;
  v_pr06_count  INTEGER;
  v_updated     INTEGER;
BEGIN
  SELECT count(*) INTO v_final_count FROM process_master WHERE process_code = 'final_block';
  SELECT count(*) INTO v_pr06_count  FROM process_master WHERE process_code = 'pr-06';

  -- Reject a still-un-normalized state (phase63 not applied / incomplete).
  IF v_pr06_count > 0 THEN
    RAISE EXCEPTION 'phase64: % pr-06 row(s) still present — run phase63 first; refusing to configure', v_pr06_count;
  END IF;

  -- Reject missing / duplicate target — never a silent zero-row no-op.
  IF v_final_count <> 1 THEN
    RAISE EXCEPTION 'phase64: expected exactly one final_block row, found % — aborting (no silent no-op)', v_final_count;
  END IF;

  UPDATE process_master
  SET
    active              = true,
    process_group       = 'LASER',
    completion_mode     = 'RETURN_BASED',
    input_item_category = 'growth_diamond',
    allowed_outputs = '[
      { "type": "usable",   "label": "Rough Diamond", "suffix": "R", "status": "IN STOCK",
        "item_category_override": "rough", "transform_in_place": true,
        "input_item_category": "growth_diamond" },
      { "type": "damaged",  "label": "Damaged",  "suffix": "D", "status": "DAMAGED" },
      { "type": "consumed", "label": "Consumed", "suffix": "C", "status": "CONSUMED" }
    ]'::jsonb
  WHERE process_code = 'final_block';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'phase64: expected to configure exactly one row, updated % — aborting', v_updated;
  END IF;

  RAISE NOTICE 'phase64: configured final_block transform (rows updated = %)', v_updated;
END $$;

COMMIT;

-- Verification (manual, after applying):
--   SELECT process_code, process_name, process_group, completion_mode,
--          input_item_category, active, allowed_outputs
--   FROM process_master WHERE process_code = 'final_block';
-- Expect exactly ONE row, LASER group, RETURN_BASED, input growth_diamond,
-- active true, with the usable rule carrying transform_in_place=true and
-- item_category_override='rough'.
