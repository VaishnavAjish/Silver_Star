-- ============================================================================
-- SSD-086 AWAITING-OUTPUT — READ-ONLY PRODUCTION INSPECTION (Phase 2)
-- Run on EC2:  psql -U postgres -d silverstar_grow -f server/sql/ssd086-inspection.sql
-- Makes NO changes: read-only transaction, finishes with ROLLBACK.
-- ============================================================================

BEGIN TRANSACTION READ ONLY;

-- ── 1. Process Master (canonical Growth = pr-01) ─────────────────────────────
SELECT 'PROCESS_MASTER' AS section,
       id, process_code, process_name, completion_mode, active, updated_at
FROM process_master
WHERE process_code = 'pr-01' OR LOWER(process_name) LIKE '%growth%';

-- ── 2. Machine SSD-086 / CVD-M-86 ────────────────────────────────────────────
SELECT 'MACHINE' AS section,
       id, code, name, status, updated_at
FROM machines
WHERE code = 'CVD-M-86' OR name ILIKE '%SSD-086%';

-- ── 3. Machine processes on that machine (newest first) ──────────────────────
SELECT 'MACHINE_PROCESS' AS section,
       mp.id, mp.process_number, mp.process_type, mp.status,
       mp.started_at, mp.completed_at, mp.created_at
FROM machine_processes mp
JOIN machines m ON m.id = mp.machine_id
WHERE m.code = 'CVD-M-86'
ORDER BY mp.id DESC
LIMIT 10;

-- ── 4. Active-process conflict check (must be exactly 1 non-terminal) ────────
SELECT 'ACTIVE_PROCESS_COUNT' AS section,
       COUNT(*) AS active_count
FROM machine_processes mp
JOIN machines m ON m.id = mp.machine_id
WHERE m.code = 'CVD-M-86'
  AND mp.status IN ('running', 'hold');

-- ── 5. Issues for the active process ─────────────────────────────────────────
SELECT 'ISSUES' AS section,
       lpi.id AS issue_id, lpi.issue_number, lpi.status,
       lpi.issued_qty, lpi.remaining_in_process,
       lpi.source_lot_id, lpi.process_lot_id
FROM lot_process_issues lpi
JOIN machine_processes mp ON mp.id = lpi.machine_process_id
JOIN machines m ON m.id = mp.machine_id
WHERE m.code = 'CVD-M-86' AND mp.status IN ('running', 'hold');

-- ── 6. Issue aggregates (guard predicates) ───────────────────────────────────
SELECT 'ISSUE_AGGREGATES' AS section,
       COUNT(*)                                                        AS total_issues,
       COUNT(*) FILTER (WHERE lpi.status = 'OPEN')                     AS open_issues,
       COUNT(*) FILTER (WHERE lpi.status = 'OPEN'
                          AND COALESCE(lpi.remaining_in_process,0) > 0) AS returnable_issue_count,
       COUNT(*) FILTER (WHERE lpi.status = 'RETURNED')                 AS returned_issues,
       COUNT(*) FILTER (WHERE lpi.remaining_in_process IS NULL)        AS null_remaining,
       COALESCE(SUM(lpi.remaining_in_process), -1)                     AS remaining_sum,
       bool_and(lpi.status = 'RETURNED')                               AS all_returned
FROM lot_process_issues lpi
JOIN machine_processes mp ON mp.id = lpi.machine_process_id
JOIN machines m ON m.id = mp.machine_id
WHERE m.code = 'CVD-M-86' AND mp.status IN ('running', 'hold');

-- ── 7. Returns for those issues ──────────────────────────────────────────────
SELECT 'RETURNS' AS section,
       r.id AS return_id, r.return_number, r.issue_id,
       r.usable_qty, r.damaged_qty, r.consumed_qty,
       r.is_final, r.remaining_after, r.created_at
FROM lot_process_returns r
JOIN lot_process_issues lpi ON lpi.id = r.issue_id
JOIN machine_processes mp ON mp.id = lpi.machine_process_id
JOIN machines m ON m.id = mp.machine_id
WHERE m.code = 'CVD-M-86' AND mp.status IN ('running', 'hold')
ORDER BY r.created_at DESC;

-- ── 8. Final physical posting: Growth Run inventory for the active process ───
SELECT 'GROWTH_OUTPUT_INVENTORY' AS section,
       inv.id AS inventory_id, inv.lot_number, inv.status, it.category
FROM inventory inv
JOIN items it ON it.id = inv.item_id
JOIN machine_processes mp ON mp.id = inv.machine_process_id
JOIN machines m ON m.id = mp.machine_id
WHERE m.code = 'CVD-M-86' AND mp.status IN ('running', 'hold');

-- ── 9. Growth Number / Run identity check ────────────────────────────────────
SELECT 'GROWTH_IDENTITY' AS section, inv.lot_number, inv.status
FROM inventory inv
WHERE inv.lot_number LIKE 'SSD086-JUL26-031%';

-- ── 10. Recent machine status audit trail ────────────────────────────────────
SELECT 'STATUS_LOG' AS section,
       msl.id, msl.old_status, msl.new_status, msl.changed_at, msl.remarks
FROM machine_status_logs msl
JOIN machines m ON m.id = msl.machine_id
WHERE m.code = 'CVD-M-86'
ORDER BY msl.changed_at DESC
LIMIT 10;

ROLLBACK;
