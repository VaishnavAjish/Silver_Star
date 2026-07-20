-- ============================================================================
-- UNIVERSAL GROWTH-AGAIN PAIRS — READ-ONLY DIAGNOSTIC
-- Groups: SSD027 (100844 → 100870-R1), SSD047 (100745 → 100871-R1),
--         SSD116 (100812, display-only "(R2)"), SSD013 (100594 / dup 100867).
-- Run on EC2:  node server/run-inspection.js server/sql/growth-again-pairs-diagnostic.sql
--        or :  psql -U postgres -d silverstar_grow -f server/sql/growth-again-pairs-diagnostic.sql
-- Makes NO changes: read-only transaction, finishes with ROLLBACK.
-- The Growth-Again identity fix (5dd7293) landed 2026-07-17: rows created
-- before that date are HISTORICAL_OLD_BUILD_ONLY candidates.
-- ============================================================================

BEGIN TRANSACTION READ ONLY;

-- ── 1. All reference inventory rows ──────────────────────────────────────────
SELECT 'ROWS' AS section,
       inv.id, inv.lot_number, it.category, it.name AS item_name,
       inv.status, inv.run_no, inv.qty, inv.weight,
       inv.dim_length, inv.dim_depth, inv.dim_height, inv.dim_unit,
       inv.rate, inv.total_value,
       inv.root_lot_id, inv.parent_lot_id, inv.machine_process_id,
       inv.created_at, inv.updated_at
FROM inventory inv JOIN items it ON it.id = inv.item_id
WHERE inv.id IN (100594,100867,100844,100870,100745,100871,100812)
   OR inv.lot_number IN ('SSD013-APR26-011','SSD001-JUL26-055',
        'SSD027-APR26-033','SSD027-APR26-033-R1',
        'SSD047-JUN26-032','SSD047-JUN26-032-R1','SSD116-JUN26-057')
ORDER BY inv.lot_number, inv.id;

-- ── 2. Origin: Issue / process / Return that produced each new-looking child ─
SELECT 'CHILD_ORIGIN' AS section,
       child.id AS child_id, child.lot_number AS child_lot,
       child.created_at AS child_created_at,
       (child.created_at < TIMESTAMP '2026-07-17') AS predates_growthagain_fix,
       prl.return_id, r.return_number, r.created_at AS return_created_at,
       pi.id AS issue_id, pi.issue_number, pi.process_type,
       pm.process_group, pm.completion_mode,
       mp.id AS machine_process_id, mp.status AS mp_status,
       src.id AS input_lot_id, src.lot_number AS input_lot, src.status AS input_status
FROM inventory child
LEFT JOIN process_return_lines prl ON prl.lot_id = child.id
LEFT JOIN lot_process_returns r    ON r.id = prl.return_id
LEFT JOIN lot_process_issues pi    ON pi.id = r.issue_id
LEFT JOIN process_master pm        ON pm.process_code = pi.process_type
LEFT JOIN machine_processes mp     ON mp.id = pi.machine_process_id
LEFT JOIN inventory src            ON src.id = COALESCE(pi.process_lot_id, pi.source_lot_id)
WHERE child.id IN (100870, 100871, 100867);

-- ── 3. Full transaction history per reference lot ───────────────────────────
SELECT 'LOT_LOG' AS section, l.lot_id, inv.lot_number, l.operation,
       l.reference_type, l.reference_id, l.qty_delta, l.new_status,
       l.performed_at, l.notes
FROM lot_op_log l JOIN inventory inv ON inv.id = l.lot_id
WHERE l.lot_id IN (100594,100867,100844,100870,100745,100871,100812)
ORDER BY l.lot_id, l.performed_at;

-- ── 4. Downstream references on the child rows (rewiring feasibility) ────────
SELECT 'CHILD_DOWNSTREAM' AS section, child_id, ref_kind, ref_count FROM (
  SELECT inv.id AS child_id, 'issues_as_source' AS ref_kind,
         (SELECT COUNT(*) FROM lot_process_issues x
           WHERE x.source_lot_id = inv.id OR x.process_lot_id = inv.id) AS ref_count
  FROM inventory inv WHERE inv.id IN (100870,100871,100867)
  UNION ALL
  SELECT inv.id, 'machine_process_lots',
         (SELECT COUNT(*) FROM machine_process_lots x WHERE x.inventory_lot_id = inv.id)
  FROM inventory inv WHERE inv.id IN (100870,100871,100867)
  UNION ALL
  SELECT inv.id, 'children_lots',
         (SELECT COUNT(*) FROM inventory x WHERE x.parent_lot_id = inv.id OR x.root_lot_id = inv.id)
  FROM inventory inv WHERE inv.id IN (100870,100871,100867)
) t ORDER BY child_id, ref_kind;

-- ── 5. Per-pair classification ───────────────────────────────────────────────
SELECT 'PAIR_CLASSIFICATION' AS section, pair, orig_id, child_id,
  CASE
    WHEN child_id IS NULL THEN 'DISPLAY_ONLY_NO_DEFECT'
    WHEN child_status IS NULL OR orig_status IS NULL THEN 'AMBIGUOUS_MANUAL_REVIEW'
    WHEN child_status IN ('CONSUMED','DISPOSED','ARCHIVED')
     AND orig_status NOT IN ('CONSUMED','DISPOSED','ARCHIVED')
                                            THEN 'HISTORICAL_DUPLICATE_ALREADY_NEUTRALIZED'
    WHEN child_downstream = 0 AND child_predates_fix
                                            THEN 'SAFE_IDENTITY_RECONCILIATION_CANDIDATE (HISTORICAL_OLD_BUILD_ONLY)'
    WHEN child_downstream = 0 AND NOT child_predates_fix
                                            THEN 'SAFE_IDENTITY_RECONCILIATION_CANDIDATE (CURRENT_CODE_STILL_REPRODUCIBLE — verify deploy SHA)'
    WHEN child_downstream > 0               THEN 'AMBIGUOUS_MANUAL_REVIEW (downstream references exist)'
    ELSE 'AMBIGUOUS_MANUAL_REVIEW'
  END AS classification,
  orig_status, child_status, child_predates_fix, child_downstream
FROM (
  SELECT p.pair, p.orig_id, p.child_id,
         (SELECT status FROM inventory WHERE id = p.orig_id)  AS orig_status,
         (SELECT status FROM inventory WHERE id = p.child_id) AS child_status,
         (SELECT created_at < TIMESTAMP '2026-07-17' FROM inventory WHERE id = p.child_id) AS child_predates_fix,
         COALESCE((SELECT COUNT(*) FROM lot_process_issues x
                    WHERE x.source_lot_id = p.child_id OR x.process_lot_id = p.child_id), 0)
       + COALESCE((SELECT COUNT(*) FROM inventory x
                    WHERE x.parent_lot_id = p.child_id OR x.root_lot_id = p.child_id), 0) AS child_downstream
  FROM (VALUES
    ('SSD027', 100844, 100870),
    ('SSD047', 100745, 100871),
    ('SSD013', 100594, 100867),
    ('SSD116', 100812, NULL::int)
  ) AS p(pair, orig_id, child_id)
) c ORDER BY pair;

ROLLBACK;
