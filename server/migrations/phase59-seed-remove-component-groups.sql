-- ============================================================
-- Phase 59: Seed Remove — full COMPONENT GROUPS (DATA ONLY)
-- ============================================================
-- RETURN ENGINE PHASE A. Supersedes phase57 (phase57 is now
-- optional; applying it first is harmless — this migration
-- REPLACES the whole seed_remove allowed_outputs array).
-- Requires phase56 (allowed_outputs configured); phase58 only
-- inserts missing process_master rows and is independent.
--
-- Business rule: every Partial Growth Run physically contains
-- 1 Seed + 1 Growth Diamond. A Seed Remove return must account
-- for BOTH, independently:
--   Group A (component=seed):    recovered/damaged/consumed/QC = input qty
--   Group B (component=diamond): usable/damaged/consumed/QC    = input qty
-- Groups are NEVER summed together (backend gate enforces this).
--
-- Type keys 'reprocess' (Recovered Seed) and 'usable' (Growth
-- Diamond) are preserved from phase56/57 for backward compat
-- with existing return lines and the legacy usable_qty aggregate.
-- Suffixes are unique; nextReturnLotCode handles multi-char
-- suffixes (numeric-tail parse skips sibling prefixes).
--
-- Idempotent: plain UPDATE to a constant value.
-- DO NOT AUTO-RUN. Apply manually on EC2:
--   psql -U postgres -d silverstar_grow -f phase59-seed-remove-component-groups.sql

BEGIN;

-- Guard: phase56 must already be applied (seed_remove row configured).
DO $$
DECLARE
  n integer;
BEGIN
  SELECT jsonb_array_length(COALESCE(allowed_outputs, '[]'::jsonb))
    INTO n
    FROM process_master
   WHERE process_code = 'seed_remove';

  IF n IS NULL THEN
    RAISE EXCEPTION 'phase59: process_master has no seed_remove row — apply phase58-seed-missing-processes.sql first';
  END IF;
  IF n = 0 THEN
    RAISE EXCEPTION 'phase59: seed_remove has no allowed_outputs — apply phase56_allowed_outputs.sql first';
  END IF;
END $$;

UPDATE process_master SET allowed_outputs = '[
  { "type": "reprocess",        "label": "Recovered Seed",   "suffix": "S",  "status": "IN STOCK", "item_category_override": "seed",           "component": "seed" },
  { "type": "seed_damaged",     "label": "Seed Damaged",     "suffix": "SD", "status": "DAMAGED",  "item_category_override": "seed",           "component": "seed" },
  { "type": "seed_consumed",    "label": "Seed Consumed",    "suffix": "SC", "status": "CONSUMED", "item_category_override": "seed",           "component": "seed" },
  { "type": "seed_qc",          "label": "Seed QC Hold",     "suffix": "SQ", "status": "QC_HOLD",  "item_category_override": "seed",           "component": "seed" },
  { "type": "usable",           "label": "Growth Diamond",   "suffix": "R",  "status": "IN STOCK", "item_category_override": "growth_diamond", "component": "diamond" },
  { "type": "diamond_damaged",  "label": "Diamond Damaged",  "suffix": "GD", "status": "DAMAGED",  "item_category_override": "growth_diamond", "component": "diamond" },
  { "type": "diamond_consumed", "label": "Diamond Consumed", "suffix": "GC", "status": "CONSUMED", "item_category_override": "growth_diamond", "component": "diamond" },
  { "type": "diamond_qc",       "label": "Diamond QC Hold",  "suffix": "GQ", "status": "QC_HOLD",  "item_category_override": "growth_diamond", "component": "diamond" }
]'::jsonb
WHERE process_code = 'seed_remove';

-- Verification (visual): 8 rules, each with a component tag.
SELECT process_code,
       elem->>'type'      AS type,
       elem->>'label'     AS label,
       elem->>'component' AS component,
       elem->>'suffix'    AS suffix
FROM process_master, jsonb_array_elements(allowed_outputs) AS elem
WHERE process_code = 'seed_remove'
ORDER BY elem->>'component', elem->>'type';

COMMIT;

-- ── ROLLBACK (manual — restores the phase56 array) ───────────
-- BEGIN;
-- UPDATE process_master SET allowed_outputs = '[
--   { "type": "reprocess", "label": "Recovered Seed", "suffix": "S", "status": "IN STOCK", "item_category_override": "seed" },
--   { "type": "usable",    "label": "Growth Diamond", "suffix": "R", "status": "IN STOCK", "item_category_override": "growth_diamond" },
--   { "type": "damaged",   "label": "Damaged",        "suffix": "D", "status": "DAMAGED" },
--   { "type": "consumed",  "label": "Consumed",       "suffix": "C", "status": "CONSUMED" }
-- ]'::jsonb
-- WHERE process_code = 'seed_remove';
-- COMMIT;
