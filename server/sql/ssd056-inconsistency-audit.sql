-- ============================================================================
-- SSD-056 CLASS — READ-ONLY STALE-RETURN INCONSISTENCY AUDIT
-- Finds all Process Issues left OPEN/returnable while their linked
-- machine_process is already completed (the legacy Control Tower Complete
-- Process path completed + released the machine without closing the issue).
--
-- Run on EC2:  psql -U postgres -d silverstar_grow -f server/sql/ssd056-inconsistency-audit.sql
-- Makes NO changes: read-only transaction, finishes with ROLLBACK.
-- Do NOT bulk-repair from this output — it is a candidate list for owner review.
-- ============================================================================

BEGIN TRANSACTION READ ONLY;

WITH candidates AS (
  SELECT
    lpi.id                                   AS issue_id,
    lpi.issue_number,
    lpi.status                               AS issue_status,
    lpi.issued_qty,
    COALESCE(lpi.remaining_in_process, lpi.issued_qty) AS remaining_qty,
    lpi.machine_process_id,
    mp.status                                AS machine_process_status,
    mp.completed_at                          AS machine_process_completed_at,
    mp.process_type,
    m.code                                   AS machine_code,
    m.status                                 AS machine_status,
    gr.lot_number                            AS growth_number,
    gr.run_no,
    gr.status                                AS growth_output_status,
    (SELECT count(*) FROM inventory g2
       JOIN items it2 ON it2.id = g2.item_id
      WHERE g2.machine_process_id = mp.id AND it2.category = 'growth_run') AS growth_output_count,
    (SELECT count(r.id)
       FROM lot_process_returns r
      WHERE r.issue_id = lpi.id)             AS canonical_return_count
  FROM lot_process_issues lpi
  JOIN machine_processes mp ON mp.id = lpi.machine_process_id
  LEFT JOIN machines m ON m.id = mp.machine_id
  LEFT JOIN inventory gr ON gr.machine_process_id = mp.id
                        AND gr.item_id = (SELECT id FROM items WHERE category = 'growth_run' LIMIT 1)
  WHERE lpi.status = 'OPEN'
    AND COALESCE(lpi.remaining_in_process, lpi.issued_qty) > 0.0001
    AND mp.status IN ('completed', 'cancelled')
)
SELECT
  c.*,
  CASE
    -- 1. Safe legacy-completion reconciliation candidate: process completed,
    --    exactly one growth output posted and IN STOCK, no canonical Return yet.
    WHEN c.machine_process_status = 'completed'
     AND c.machine_process_completed_at IS NOT NULL
     AND c.growth_output_count = 1
     AND c.growth_output_status = 'IN STOCK'
     AND c.canonical_return_count = 0
      THEN 'SAFE_LEGACY_RECONCILIATION_CANDIDATE'
    -- 4. Has a canonical Return already — review (should normally be RETURNED).
    WHEN c.canonical_return_count > 0
      THEN 'HAS_CANONICAL_RETURN_REVIEW'
    -- 3. Ambiguous: missing/duplicate output, cancelled process, or no output.
    WHEN c.machine_process_status = 'cancelled'
      OR c.growth_output_count <> 1
      OR c.growth_output_status IS DISTINCT FROM 'IN STOCK'
      THEN 'AMBIGUOUS_MANUAL_REVIEW'
    ELSE 'GENUINE_PENDING_OR_OTHER'
  END AS classification
FROM candidates c
ORDER BY classification, c.machine_code, c.issue_number;

-- Summary counts per classification (for the owner review header).
WITH candidates AS (
  SELECT lpi.id AS issue_id, mp.status AS mps, mp.completed_at AS cat,
         (SELECT count(*) FROM inventory g2 JOIN items it2 ON it2.id = g2.item_id
            WHERE g2.machine_process_id = mp.id AND it2.category = 'growth_run') AS goc,
         (SELECT max(g2.status) FROM inventory g2 JOIN items it2 ON it2.id = g2.item_id
            WHERE g2.machine_process_id = mp.id AND it2.category = 'growth_run') AS gos,
         (SELECT count(r.id) FROM lot_process_returns r WHERE r.issue_id = lpi.id) AS crc
  FROM lot_process_issues lpi
  JOIN machine_processes mp ON mp.id = lpi.machine_process_id
  WHERE lpi.status = 'OPEN'
    AND COALESCE(lpi.remaining_in_process, lpi.issued_qty) > 0.0001
    AND mp.status IN ('completed', 'cancelled')
)
SELECT
  count(*) FILTER (WHERE mps='completed' AND cat IS NOT NULL AND goc=1 AND gos='IN STOCK' AND crc=0) AS safe_candidates,
  count(*) FILTER (WHERE crc > 0)                                                                    AS has_canonical_return,
  count(*) FILTER (WHERE mps='cancelled' OR goc<>1 OR gos IS DISTINCT FROM 'IN STOCK')               AS ambiguous,
  count(*)                                                                                            AS total_candidates
FROM candidates;

ROLLBACK;
