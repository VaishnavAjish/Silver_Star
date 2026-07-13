-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 52 — Backfill dimensions on lots created by Mix
--
-- The Mix handler's child INSERT never listed dim_length / dim_depth / dim_height
-- / dim_unit, so every mixed lot was created with NULL dimensions (the Lot
-- Workspace rendered them as "—"). Split and Process Issue always carried them
-- forward; Mix was the sole omission. The route is fixed; this repairs the rows it
-- already wrote.
--
-- The data is recoverable because the parent-consume step only ever zeroed
-- qty / weight / total_value — it never cleared the parents' dim_* columns — and
-- lot_mix_components still records which parents fed which child.
--
-- Rule (identical to services/lotDimensions.js): a child inherits a dimension only
-- when every measured parent agrees on it. NULL means "not yet measured", so it
-- neither blocks inheritance nor overwrites a measured value. Children whose
-- parents genuinely disagree are LEFT NULL and reported at the end for manual
-- review — this migration never invents a dimension.
--
-- Idempotent: only touches mixed lots that are still fully unmeasured.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

WITH parent_dims AS (
  SELECT
    mc.mixed_lot_id,
    COUNT(DISTINCT p.dim_length) FILTER (WHERE p.dim_length IS NOT NULL) AS n_length,
    COUNT(DISTINCT p.dim_depth)  FILTER (WHERE p.dim_depth  IS NOT NULL) AS n_depth,
    COUNT(DISTINCT p.dim_height) FILTER (WHERE p.dim_height IS NOT NULL) AS n_height,
    COUNT(DISTINCT p.dim_unit)   FILTER (WHERE p.dim_unit   IS NOT NULL) AS n_unit,
    MIN(p.dim_length) AS dim_length,
    MIN(p.dim_depth)  AS dim_depth,
    MIN(p.dim_height) AS dim_height,
    MIN(p.dim_unit)   AS dim_unit
  FROM lot_mix_components mc
  JOIN inventory p ON p.id = mc.source_lot_id
  GROUP BY mc.mixed_lot_id
)
UPDATE inventory child
SET    dim_length = pd.dim_length,
       dim_depth  = pd.dim_depth,
       dim_height = pd.dim_height,
       dim_unit   = COALESCE(pd.dim_unit, 'mm'),
       updated_at = NOW()
FROM   parent_dims pd
WHERE  child.id = pd.mixed_lot_id
  AND  child.source_type = 'mix'
  -- Only repair lots that were never measured; never overwrite a real measurement.
  AND  child.dim_length IS NULL
  AND  child.dim_depth  IS NULL
  AND  child.dim_height IS NULL
  -- Every measured parent must agree on every axis (<= 1 distinct non-null value).
  AND  pd.n_length <= 1
  AND  pd.n_depth  <= 1
  AND  pd.n_height <= 1
  AND  pd.n_unit   <= 1
  -- At least one axis was actually measured, or there is nothing to inherit.
  AND  (pd.dim_length IS NOT NULL OR pd.dim_depth IS NOT NULL OR pd.dim_height IS NOT NULL);

-- Report the mixed lots this migration deliberately did NOT touch because their
-- parents disagree. These need an operator to measure the physical lot. Going
-- forward, the fixed route blocks such a mix outright.
DO $$
DECLARE
  conflicted RECORD;
  found_any  BOOLEAN := FALSE;
BEGIN
  FOR conflicted IN
    SELECT child.id, child.lot_number
    FROM   inventory child
    JOIN   lot_mix_components mc ON mc.mixed_lot_id = child.id
    JOIN   inventory p ON p.id = mc.source_lot_id
    WHERE  child.source_type = 'mix'
      AND  child.dim_length IS NULL
      AND  child.dim_depth  IS NULL
      AND  child.dim_height IS NULL
    GROUP BY child.id, child.lot_number
    HAVING COUNT(DISTINCT p.dim_length) FILTER (WHERE p.dim_length IS NOT NULL) > 1
        OR COUNT(DISTINCT p.dim_depth)  FILTER (WHERE p.dim_depth  IS NOT NULL) > 1
        OR COUNT(DISTINCT p.dim_height) FILTER (WHERE p.dim_height IS NOT NULL) > 1
        OR COUNT(DISTINCT p.dim_unit)   FILTER (WHERE p.dim_unit   IS NOT NULL) > 1
  LOOP
    found_any := TRUE;
    RAISE NOTICE 'MANUAL REVIEW — mixed lot % (id %) has parents with conflicting dimensions; left unmeasured.',
      conflicted.lot_number, conflicted.id;
  END LOOP;

  IF NOT found_any THEN
    RAISE NOTICE 'No dimension conflicts found — every mixed lot was either repaired or had nothing to inherit.';
  END IF;
END $$;

COMMIT;
