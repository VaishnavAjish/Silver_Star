-- Phase 77 Migration: Growth Process Lot ↔ Growth Number Identity Fix
-- Corrects stored process_lot_id on lot_process_issues for Growth-group processes
-- where process_lot_id incorrectly pointed to the seed source lot instead of the generated Growth inventory row.

-- PREVIEW SELECT: Unreconciled Growth Issues
SELECT 
  pi.id AS process_issue_id,
  pi.issue_number,
  pi.machine_process_id,
  pi.source_lot_id AS seed_source_id,
  sl.lot_number AS seed_source_lot,
  pi.process_lot_id AS current_process_lot_id,
  pl.lot_number AS current_process_lot_name,
  gr.id AS expected_growth_inventory_id,
  gr.lot_number AS expected_growth_number
FROM lot_process_issues pi
JOIN process_master pm ON pm.process_code = pi.process_type
JOIN inventory sl ON sl.id = pi.source_lot_id
LEFT JOIN inventory pl ON pl.id = pi.process_lot_id
JOIN inventory gr ON gr.machine_process_id = pi.machine_process_id
                 AND gr.item_id IN (SELECT id FROM items WHERE category IN ('growth_run', 'growth_diamond'))
WHERE (pm.process_group = 'GROWTH' OR pi.process_type = 'growth')
  AND (pi.process_lot_id IS NULL OR pi.process_lot_id != gr.id);

BEGIN;

-- GUARDED UPDATE: Only update rows with unambiguous 1-to-1 matching Growth inventory row
UPDATE lot_process_issues pi
SET process_lot_id = gr.id
FROM machine_processes mp
JOIN process_master pm ON pm.process_code = mp.process_type
JOIN inventory gr ON gr.machine_process_id = mp.id
                 AND gr.item_id IN (SELECT id FROM items WHERE category IN ('growth_run', 'growth_diamond'))
WHERE pi.machine_process_id = mp.id
  AND (pm.process_group = 'GROWTH' OR mp.process_type = 'growth')
  AND (pi.process_lot_id IS NULL OR pi.process_lot_id != gr.id);

-- POST-UPDATE VERIFICATION
SELECT 
  pi.id AS process_issue_id,
  pi.issue_number,
  pi.process_lot_id,
  pl.lot_number AS process_lot_name,
  gr.lot_number AS growth_number
FROM lot_process_issues pi
JOIN process_master pm ON pm.process_code = pi.process_type
JOIN inventory pl ON pl.id = pi.process_lot_id
JOIN inventory gr ON gr.machine_process_id = pi.machine_process_id
                 AND gr.item_id IN (SELECT id FROM items WHERE category IN ('growth_run', 'growth_diamond'))
WHERE (pm.process_group = 'GROWTH' OR pi.process_type = 'growth')
  AND (pi.process_lot_id != gr.id OR pl.lot_number != gr.lot_number);

-- Default safety: ROLLBACK until explicit user approval after database backup.
ROLLBACK;
-- To apply: replace ROLLBACK; with COMMIT;
