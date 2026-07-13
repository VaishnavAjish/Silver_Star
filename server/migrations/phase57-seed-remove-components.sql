-- ============================================================
-- Phase 57: Seed Remove — COMPONENT-mode tags (DATA ONLY)
-- ============================================================
-- Adds "component" tags to the seed_remove output rules in
-- process_master.allowed_outputs (JSONB — no DDL needed):
--   reprocess / Recovered Seed  → "component": "seed"
--   usable    / Growth Diamond  → "component": "diamond"
--
-- This is what activates COMPONENT mode in the return balance
-- gate (server/routes/lotProcessIssues.js POST /:id/return):
-- each component is validated separately against the input —
-- Growth Diamond qty (CT) and Recovered Seed qty (PCS) are
-- NEVER summed — the input lot is fully consumed, and output
-- weight may not exceed input weight.
--
-- Untagged outputs (damaged, consumed) stay in the implicit
-- 'primary' component group, unchanged.
--
-- Idempotent: the jsonb merge (||) writes the same value on
-- re-run. Requires phase56_allowed_outputs.sql; aborts (and
-- rolls back) if seed_remove has no configured outputs.
--
-- DO NOT AUTO-RUN. Apply manually on EC2:
--   psql -U postgres -d silverstar_grow -f phase57-seed-remove-components.sql

BEGIN;

-- Guard: phase56 must already be applied. Abort the transaction
-- (nothing committed) instead of silently tagging nothing.
DO $$
DECLARE
  n integer;
BEGIN
  SELECT jsonb_array_length(COALESCE(allowed_outputs, '[]'::jsonb))
    INTO n
    FROM process_master
   WHERE process_code = 'seed_remove';

  IF n IS NULL THEN
    RAISE EXCEPTION 'phase57: process_master has no seed_remove row';
  END IF;
  IF n = 0 THEN
    RAISE EXCEPTION 'phase57: seed_remove has no allowed_outputs — apply phase56_allowed_outputs.sql first';
  END IF;
END $$;

UPDATE process_master pm
SET allowed_outputs = (
  SELECT jsonb_agg(
    CASE elem->>'type'
      WHEN 'reprocess' THEN elem || '{"component": "seed"}'::jsonb
      WHEN 'usable'    THEN elem || '{"component": "diamond"}'::jsonb
      ELSE elem
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(pm.allowed_outputs) WITH ORDINALITY AS t(elem, ord)
)
WHERE pm.process_code = 'seed_remove'
  AND jsonb_array_length(COALESCE(pm.allowed_outputs, '[]'::jsonb)) > 0;

-- Verification (visual): reprocess→seed and usable→diamond must appear.
SELECT process_code,
       elem->>'type'      AS type,
       elem->>'label'     AS label,
       elem->>'component' AS component
FROM process_master, jsonb_array_elements(allowed_outputs) AS elem
WHERE process_code = 'seed_remove'
ORDER BY elem->>'type';

COMMIT;
