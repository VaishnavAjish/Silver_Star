-- Phase 64 — Final Block: Growth Diamond → Rough Diamond in-place transform
-- CONFIGURATION migration (data-only; no schema change). DO NOT auto-apply —
-- run manually on EC2, strictly AFTER phase63-reconcile-legacy-processes.sql.
--
-- Target: the single canonical Final Block process that phase63 establishes
-- by renaming pr-06 → 'final_block'. This UPDATE is idempotent and a safe
-- no-op when 'final_block' does not exist yet (0 rows updated) — it never
-- guesses at block_cut / pr-06 / growth_cut.
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
-- completion_mode returns to RETURN_BASED: the in-place transformation IS the
-- terminal output of this process — there is no separate Growth-Output-style
-- posting afterwards, so the machine must not wait in awaiting_output.
-- (phase63 set OUTPUT_BASED while copying block_cut's legacy configuration.)

BEGIN;

UPDATE process_master
SET
  completion_mode = 'RETURN_BASED',
  input_item_category = 'growth_diamond',
  allowed_outputs = '[
    { "type": "usable",   "label": "Rough Diamond", "suffix": "R", "status": "IN STOCK",
      "item_category_override": "rough", "transform_in_place": true,
      "input_item_category": "growth_diamond" },
    { "type": "damaged",  "label": "Damaged",  "suffix": "D", "status": "DAMAGED" },
    { "type": "consumed", "label": "Consumed", "suffix": "C", "status": "CONSUMED" }
  ]'::jsonb
WHERE process_code = 'final_block';

-- Verification (manual, after applying):
--   SELECT process_code, process_name, process_group, completion_mode,
--          input_item_category, allowed_outputs
--   FROM process_master WHERE process_code = 'final_block';
-- Expect exactly ONE row, LASER group, RETURN_BASED, the usable rule carrying
-- transform_in_place=true and item_category_override='rough'.

COMMIT;
