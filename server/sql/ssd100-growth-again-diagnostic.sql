-- ============================================================================
-- SSD-100 GROWTH-AGAIN RETURN — READ-ONLY DIAGNOSTIC
-- Case: machine CVD-M-100 (SSD-100), Issue PI-202607-0385, inventory 100594,
--       lot SSD013-APR26-011, Run R4.
-- Run on EC2:  node server/run-inspection.js server/sql/ssd100-growth-again-diagnostic.sql
--        or :  psql -U postgres -d silverstar_grow -f server/sql/ssd100-growth-again-diagnostic.sql
-- Makes NO changes: read-only transaction, finishes with ROLLBACK.
-- Section 6 CLASSIFICATION gates phase71-ssd100-machine-release.sql.
-- ============================================================================

BEGIN TRANSACTION READ ONLY;

-- ── 1. Process Issue ─────────────────────────────────────────────────────────
SELECT 'ISSUE' AS section,
       pi.id, pi.issue_number, pi.status, pi.issued_qty, pi.remaining_in_process,
       ROUND(pi.issued_qty - COALESCE(pi.remaining_in_process, pi.issued_qty), 4) AS returned_qty_derived,
       pi.source_lot_id, pi.process_lot_id, pi.machine_id, pi.machine_process_id,
       pl.lot_number AS carrier_lot, pl.run_no AS carrier_run,
       pl.qty AS carrier_qty, pl.weight AS carrier_weight,
       pl.dim_length, pl.dim_depth, pl.dim_height, pl.dim_unit,
       pli.category AS carrier_category,
       mpl.issued_qty AS snapshot_issued_qty, mpl.issued_weight AS snapshot_issued_weight
FROM lot_process_issues pi
LEFT JOIN inventory pl ON pl.id = pi.process_lot_id
LEFT JOIN items pli    ON pli.id = pl.item_id
LEFT JOIN machine_process_lots mpl ON mpl.process_id = pi.machine_process_id
                                  AND mpl.inventory_lot_id = pi.process_lot_id
WHERE pi.issue_number = 'PI-202607-0385';

-- ── 2. Linked machine process (+ every process on SSD-100, newest first) ─────
SELECT 'MACHINE_PROCESS' AS section,
       mp.id, mp.machine_id, mp.status, mp.started_at, mp.completed_at,
       mp.process_type, mp.process_number,
       (mp.status IN ('running','hold')) AS is_active,
       (mp.id = (SELECT machine_process_id FROM lot_process_issues WHERE issue_number = 'PI-202607-0385')) AS is_issue_linked
FROM machine_processes mp
WHERE mp.machine_id = (SELECT id FROM machines WHERE code = 'CVD-M-100')
   OR mp.id = (SELECT machine_process_id FROM lot_process_issues WHERE issue_number = 'PI-202607-0385')
ORDER BY mp.id DESC
LIMIT 10;

-- ── 3. Machine (stored vs derived) ───────────────────────────────────────────
SELECT 'MACHINE' AS section,
       m.id, m.code, m.status AS stored_status,
       CASE
         WHEN m.status::text IN ('maintenance','breakdown','cleaning') THEN m.status::text
         WHEN amp.status = 'hold' THEN 'hold'
         WHEN amp.status = 'running' THEN 'running'
         WHEN amp.id IS NULL AND m.status::text = 'idle' THEN 'idle'
         ELSE 'review'
       END AS derived_status,
       (SELECT COUNT(*) FROM machine_processes mp
         WHERE mp.machine_id = m.id AND mp.status IN ('running','hold')) AS active_process_count
FROM machines m
LEFT JOIN LATERAL (
  SELECT mp.id, mp.status FROM machine_processes mp
  WHERE mp.machine_id = m.id AND mp.status IN ('running','hold')
  ORDER BY CASE mp.status WHEN 'running' THEN 1 ELSE 2 END, mp.id DESC LIMIT 1
) amp ON true
WHERE m.code = 'CVD-M-100';

-- ── 4. Inventory 100594 (carrier — must stay untouched by reconciliation) ────
SELECT 'INVENTORY_100594' AS section,
       inv.id, inv.lot_number, inv.status, inv.run_no, inv.qty, inv.weight,
       inv.dim_length, inv.dim_depth, inv.dim_height, inv.dim_unit,
       inv.machine_process_id, inv.root_lot_id, it.category
FROM inventory inv JOIN items it ON it.id = inv.item_id
WHERE inv.id = (SELECT process_lot_id FROM lot_process_issues WHERE issue_number = 'PI-202607-0385');

-- ── 5. Returns against the Issue ─────────────────────────────────────────────
SELECT 'RETURNS' AS section,
       r.id, r.return_number, r.issue_id, r.usable_qty, r.damaged_qty,
       r.consumed_qty, r.is_final, r.remaining_after, r.created_at
FROM lot_process_returns r
JOIN lot_process_issues pi ON pi.id = r.issue_id
WHERE pi.issue_number = 'PI-202607-0385'
ORDER BY r.created_at;

-- ── 6. CLASSIFICATION (exactly one row — gates phase71) ──────────────────────
WITH i AS (
  SELECT pi.*, (SELECT COUNT(*) FROM lot_process_returns r WHERE r.issue_id = pi.id) AS return_count,
         (SELECT COUNT(*) FROM lot_process_returns r WHERE r.issue_id = pi.id AND r.is_final) AS final_return_count
  FROM lot_process_issues pi WHERE pi.issue_number = 'PI-202607-0385'
),
mp AS (SELECT * FROM machine_processes WHERE id = (SELECT machine_process_id FROM i)),
m  AS (SELECT * FROM machines WHERE code = 'CVD-M-100'),
act AS (SELECT COUNT(*) AS n FROM machine_processes
        WHERE machine_id = (SELECT id FROM m) AND status IN ('running','hold'))
SELECT 'CLASSIFICATION' AS section,
  CASE
    WHEN (SELECT machine_process_id FROM i) IS NULL                        THEN 'RETURN_LINKED_TO_WRONG_MACHINE_PROCESS'
    WHEN (SELECT machine_id FROM mp) IS DISTINCT FROM (SELECT id FROM m)   THEN 'RETURN_LINKED_TO_WRONG_MACHINE_PROCESS'
    WHEN (SELECT n FROM act) > 1                                           THEN 'MULTIPLE_OR_CONFLICTING_MACHINE_PROCESSES'
    WHEN (SELECT status FROM i) <> 'RETURNED'
      OR COALESCE((SELECT remaining_in_process FROM i), 1) > 0.0001        THEN 'ISSUE_NOT_COMPLETED'
    WHEN (SELECT final_return_count FROM i) <> 1                           THEN 'AMBIGUOUS_MANUAL_REVIEW'
    WHEN (SELECT status FROM mp) IN ('running','hold')                     THEN 'MACHINE_PROCESS_NOT_COMPLETED'
    WHEN (SELECT status FROM mp) = 'completed'
     AND (SELECT completed_at FROM mp) IS NOT NULL
     AND (SELECT n FROM act) = 0
     AND (SELECT status::text FROM m) = 'running'                          THEN 'FULL_RETURN_MACHINE_CACHE_STALE'
    ELSE 'AMBIGUOUS_MANUAL_REVIEW'
  END AS classification,
  (SELECT status FROM i)             AS issue_status,
  (SELECT remaining_in_process FROM i) AS remaining,
  (SELECT return_count FROM i)       AS return_count,
  (SELECT status FROM mp)            AS mp_status,
  (SELECT completed_at FROM mp)      AS mp_completed_at,
  (SELECT status::text FROM m)       AS machine_stored_status,
  (SELECT n FROM act)                AS active_process_count,
  (SELECT status FROM inventory WHERE id = (SELECT process_lot_id FROM lot_process_issues WHERE issue_number = 'PI-202607-0385')) AS inventory_status;

-- ── 7. Machine status history (audit trail) ──────────────────────────────────
SELECT 'STATUS_LOG' AS section, msl.old_status, msl.new_status, msl.changed_at, msl.remarks
FROM machine_status_logs msl
WHERE msl.machine_id = (SELECT id FROM machines WHERE code = 'CVD-M-100')
ORDER BY msl.changed_at DESC LIMIT 10;

ROLLBACK;
