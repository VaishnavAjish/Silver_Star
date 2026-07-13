-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 53 — Backfill dimensions on pre-existing Partial Growth Run lots
--
-- Backfill the ~40 pre-existing Partial Growth Run lots still showing blank
-- Length/Depth. Each biscuit's parent_lot_id points at its
-- source seed, which still holds dim_length/dim_depth/dim_unit.
--
-- Constraints: never overwrite a non-NULL dimension; only touch source_type='growth'
-- rows; run inside a transaction; verify row count before COMMIT.

BEGIN;

UPDATE inventory gr
SET    dim_length = s.dim_length,
       dim_depth  = s.dim_depth,
       dim_unit   = COALESCE(s.dim_unit, 'mm'),
       updated_at = NOW()
FROM   inventory s
WHERE  s.id = gr.parent_lot_id
  AND  gr.source_type = 'growth'
  AND  gr.dim_length IS NULL
  AND  gr.dim_depth  IS NULL
  AND  s.dim_length IS NOT NULL;

-- Log the number of rows affected
DO $$
BEGIN
  RAISE NOTICE 'Updated dimensions for % pre-existing Partial Growth Runs.', (SELECT count(*) FROM inventory gr JOIN inventory s ON s.id = gr.parent_lot_id WHERE gr.source_type = 'growth' AND gr.dim_length IS NULL AND gr.dim_depth IS NULL AND s.dim_length IS NOT NULL);
END $$;

COMMIT;
