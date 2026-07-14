-- ============================================================
-- Phase 61: Growth usable-output configuration repair
-- ============================================================
-- DO NOT AUTO-RUN. Apply manually on EC2:
--   psql $DATABASE_URL -f phase61-growth-usable-output-config.sql
--
-- ROOT CAUSE (live failure on PI-202607-0191/0192): custom GROWTH-group
-- processes (e.g. 'pr-01') were created via the ProcessMaster admin UI or
-- seeded (phase58) WITHOUT allowed_outputs, or with a usable rule lacking
--   "item_category_override": "growth_run".
-- The Return Engine's configuration-integrity guard (services/returnRouting.js)
-- correctly REJECTS such returns instead of minting a replacement Growth
-- identity. This migration repairs the configuration so the full usable
-- Growth Return routes to the EXISTING biscuit.
--
-- SCOPE SAFETY:
--   * Only process_group = 'GROWTH' rows are touched.
--   * seed_remove is process_group = 'LASER' (phase34) — structurally excluded.
--   * COMPONENT-mode configs (any rule carrying a "component" tag) are
--     explicitly excluded as a second guard.
--   * Idempotent: re-running changes nothing once repaired.
--
-- Pre-check (capture for rollback reference):
--   SELECT id, process_code, process_group, allowed_outputs
--   FROM process_master WHERE process_group = 'GROWTH';

BEGIN;

-- 1. GROWTH processes with NO configuration → canonical growth outputs
--    (same shape phase56 gave the native 'growth' process).
UPDATE process_master
SET allowed_outputs = '[
  { "type": "usable",   "label": "Partial Growth Run", "suffix": "R", "status": "IN STOCK", "item_category_override": "growth_run" },
  { "type": "damaged",  "label": "Damaged",  "suffix": "D", "status": "DAMAGED" },
  { "type": "consumed", "label": "Consumed", "suffix": "C", "status": "CONSUMED" }
]'::jsonb,
    updated_at = NOW()
WHERE process_group = 'GROWTH'
  AND (allowed_outputs IS NULL OR allowed_outputs = '[]'::jsonb);

-- 2. GROWTH processes WITH a configuration: force every usable rule to map
--    to the existing Growth Run identity. Order preserved; non-usable rules
--    untouched; component-mode configs skipped entirely.
UPDATE process_master pm
SET allowed_outputs = (
      SELECT jsonb_agg(
               CASE WHEN elem->>'type' = 'usable'
                    THEN jsonb_set(elem, '{item_category_override}', '"growth_run"', true)
                    ELSE elem END
               ORDER BY ord)
      FROM jsonb_array_elements(pm.allowed_outputs) WITH ORDINALITY AS t(elem, ord)
    ),
    updated_at = NOW()
WHERE pm.process_group = 'GROWTH'
  AND pm.allowed_outputs IS NOT NULL
  AND jsonb_array_length(pm.allowed_outputs) > 0
  AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(pm.allowed_outputs) e
        WHERE e ? 'component')
  AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(pm.allowed_outputs) e
        WHERE e->>'type' = 'usable'
          AND COALESCE(e->>'item_category_override', '') <> 'growth_run');

COMMIT;

-- Verification (expect every GROWTH usable rule to show growth_run):
--   SELECT process_code,
--          e->>'type' AS type, e->>'item_category_override' AS override
--   FROM process_master pm,
--        jsonb_array_elements(pm.allowed_outputs) e
--   WHERE pm.process_group = 'GROWTH';
--
-- Rollback: restore the rows captured by the pre-check SELECT above, e.g.
--   UPDATE process_master SET allowed_outputs = '<captured jsonb>'::jsonb
--   WHERE process_code = '<code>';
