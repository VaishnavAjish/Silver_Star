-- ============================================================================
-- GROWTH-AGAIN IDENTITY DIAGNOSTIC — inventory 100594 vs 100867 (READ-ONLY)
--
-- Defect: Growth Again of Growth Diamond SSD013-APR26-011 (inventory 100594)
-- minted a duplicate Partial Growth Run SSD001-JUL26-055 (inventory 100867)
-- for the SAME physical carrier — both IN PROCESS on one machine_process.
-- Root cause fixed in code (growthCarrier.js / lotProcessIssues.js Step 6).
--
-- This script is SELECT-only: no writes, no locks, no transaction required.
-- Run BEFORE phase70-growth-again-identity-reconciliation.sql and keep the
-- output — it is the exact reference and downstream-activity report the
-- reconciliation preconditions are checked against.
--
-- Run on EC2:
--   psql -U postgres -d silverstar_grow \
--     -f server/sql/growth-again-identity-diagnostic.sql
-- ============================================================================

\echo '═══ 0. Identity snapshot — both inventory rows ═══'
SELECT inv.id, inv.lot_number, inv.lot_name, it.category, inv.status,
       inv.manufacturing_state, inv.run_no, inv.qty, inv.unit, inv.weight,
       inv.rate, inv.total_value, inv.machine_process_id,
       inv.parent_lot_id, inv.root_lot_id, inv.genealogy_path,
       inv.dim_length, inv.dim_depth, inv.dim_height, inv.dim_unit,
       inv.created_at, inv.updated_at
FROM inventory inv JOIN items it ON it.id = inv.item_id
WHERE inv.id IN (100594, 100867)
ORDER BY inv.id;

\echo '═══ 1. Linked machine process(es) + issues + process lots ═══'
SELECT mp.id AS machine_process_id, mp.process_number, mp.process_type,
       mp.status, mp.machine_id, m.code AS machine_code,
       mp.created_at, mp.completed_at
FROM machine_processes mp
JOIN machines m ON m.id = mp.machine_id
WHERE mp.id IN (SELECT machine_process_id FROM inventory
                WHERE id IN (100594, 100867) AND machine_process_id IS NOT NULL)
ORDER BY mp.id;

SELECT i.id AS issue_id, i.issue_number, i.status, i.issued_qty,
       i.remaining_in_process, i.source_lot_id, i.process_lot_id,
       i.machine_process_id, i.process_type, i.issue_date
FROM lot_process_issues i
WHERE i.source_lot_id IN (100594, 100867)
   OR i.process_lot_id IN (100594, 100867)
   OR i.machine_process_id IN (SELECT machine_process_id FROM inventory
                               WHERE id IN (100594, 100867) AND machine_process_id IS NOT NULL)
ORDER BY i.id;

SELECT mpl.process_id AS machine_process_id, mpl.inventory_lot_id,
       mpl.issued_qty, mpl.issued_weight
FROM machine_process_lots mpl
WHERE mpl.inventory_lot_id IN (100594, 100867)
   OR mpl.process_id IN (SELECT machine_process_id FROM inventory
                         WHERE id IN (100594, 100867) AND machine_process_id IS NOT NULL)
ORDER BY mpl.process_id, mpl.inventory_lot_id;

\echo '═══ 2. Exact reference report — curated manufacturing tables ═══'
\echo '--- 2a. Operation log (full history, both rows) ---'
SELECT ol.lot_id, ol.operation, ol.reference_type, ol.reference_id,
       ol.qty_delta, ol.new_status, ol.notes, ol.created_at
FROM lot_op_log ol
WHERE ol.lot_id IN (100594, 100867)
ORDER BY ol.lot_id, ol.created_at, ol.id;

\echo '--- 2b. Return lines referencing either row ---'
SELECT prl.return_id, prl.return_type, prl.qty, prl.lot_id, prl.lot_code
FROM process_return_lines prl
WHERE prl.lot_id IN (100594, 100867)
ORDER BY prl.return_id;

\echo '--- 2c. Growth cycle ledger ---'
SELECT grc.growth_run_id, grc.cycle_no, grc.machine_process_id,
       grc.process_type, grc.prev_height, grc.new_height, grc.growth_mm,
       grc.prev_weight, grc.new_weight, grc.created_at
FROM growth_run_cycles grc
WHERE grc.growth_run_id IN (100594, 100867)
ORDER BY grc.growth_run_id, grc.cycle_no;

\echo '--- 2d. Mix components ---'
SELECT mixed_lot_id, source_lot_id, qty
FROM lot_mix_components
WHERE mixed_lot_id IN (100594, 100867) OR source_lot_id IN (100594, 100867);

\echo '--- 2e. Child inventory rows (genealogy descendants) ---'
SELECT id, lot_number, parent_lot_id, root_lot_id, status
FROM inventory
WHERE parent_lot_id IN (100594, 100867)
   OR (root_lot_id IN (100594, 100867) AND id NOT IN (100594, 100867))
ORDER BY id;

\echo '═══ 3. Catalog-driven FK scan — EVERY table referencing inventory.id ═══'
-- Exhaustive: enumerates all FK columns pointing at inventory(id) and counts
-- rows referencing either identity, so no referencing table is missed even if
-- the curated list above goes stale. SELECT counts only — no writes.
DO $$
DECLARE
  r RECORD;
  v_cnt bigint;
BEGIN
  FOR r IN
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
     AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'inventory'
      AND ccu.column_name = 'id'
    ORDER BY tc.table_name, kcu.column_name
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE %I IN (100594, 100867)',
      r.table_name, r.column_name
    ) INTO v_cnt;
    RAISE NOTICE 'FK scan: %.% → % row(s)', r.table_name, r.column_name, v_cnt;
  END LOOP;
END $$;

\echo '═══ 4. Downstream-activity verdict for duplicate 100867 ═══'
-- Every count below must be ZERO (op-log may contain ONLY the creation entry)
-- for phase70 reconciliation to proceed. Any non-zero count means the
-- duplicate acquired real downstream history — reconcile manually instead.
SELECT
  (SELECT count(*) FROM lot_process_issues
    WHERE source_lot_id = 100867 OR process_lot_id = 100867)      AS issues_referencing_dup,
  (SELECT count(*) FROM process_return_lines WHERE lot_id = 100867) AS return_lines_dup,
  (SELECT count(*) FROM growth_run_cycles WHERE growth_run_id = 100867) AS growth_cycles_dup,
  (SELECT count(*) FROM lot_mix_components
    WHERE mixed_lot_id = 100867 OR source_lot_id = 100867)        AS mix_components_dup,
  (SELECT count(*) FROM inventory
    WHERE parent_lot_id = 100867 OR (root_lot_id = 100867 AND id <> 100867)) AS child_lots_dup,
  (SELECT count(*) FROM machine_process_lots WHERE inventory_lot_id = 100867) AS process_lot_links_dup,
  (SELECT count(*) FROM lot_op_log
    WHERE lot_id = 100867 AND operation <> 'growth_run_created')  AS op_log_beyond_creation_dup;

\echo '═══ 5. Seed-attachment defect check on original 100594 ═══'
-- Defect 3: the legacy issue path wrongly marked the Growth Diamond carrier
-- ATTACHED_TO_GROWTH. Expected after reconciliation: NULL / AVAILABLE.
SELECT id, lot_number, manufacturing_state, status, run_no
FROM inventory WHERE id = 100594;

\echo '═══ Diagnostic complete — no data was modified. ═══'
