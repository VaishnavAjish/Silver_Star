BEGIN;

-- Enforce lock timeouts
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
DECLARE
  v_baseline_count INTEGER;
  v_strict_count INTEGER;
  v_excluded_count INTEGER;
  
  v_mp_updated INTEGER;
  v_m_updated INTEGER;
  v_audit_inserted INTEGER;
  v_ls01_updated INTEGER;
  v_post_baseline_count INTEGER;
  v_execution_time TIMESTAMP := NOW();
  
  v_rec RECORD;
BEGIN
  -- 1. Create a diagnostic table for baseline and strict evaluation
  CREATE TEMP TABLE stranded_candidates ON COMMIT DROP AS
  WITH baseline AS (
      SELECT 
          mp.id AS machine_process_id,
          m.id AS machine_id,
          m.code AS machine_code,
          mp.completed_at,
          (
              SELECT count(*) FROM lot_process_issues WHERE machine_process_id = mp.id
          ) AS total_issues,
          (
              SELECT count(*) FROM lot_process_issues WHERE machine_process_id = mp.id AND status = 'OPEN'
          ) AS open_issues,
          (
              SELECT bool_and(status = 'RETURNED') FROM lot_process_issues WHERE machine_process_id = mp.id
          ) AS all_issues_returned,
          (
              SELECT count(*) FROM lot_process_issues WHERE machine_process_id = mp.id AND remaining_in_process IS NULL
          ) AS null_remaining_issues,
          (
              SELECT COALESCE(SUM(remaining_in_process), -1) FROM lot_process_issues WHERE machine_process_id = mp.id
          ) AS sum_remaining,
          (
              SELECT count(r.id) 
              FROM lot_process_returns r
              JOIN lot_process_issues i ON i.id = r.issue_id
              WHERE i.machine_process_id = mp.id
          ) AS total_returns,
          (
              SELECT MAX(r.created_at)
              FROM lot_process_returns r
              JOIN lot_process_issues i ON i.id = r.issue_id
              WHERE i.machine_process_id = mp.id
          ) AS latest_return_created_at,
          (
              SELECT count(DISTINCT l.id)
              FROM inventory l
              JOIN items it ON it.id = l.item_id
              WHERE l.machine_process_id = mp.id AND it.category = 'growth_run'
          ) AS growth_inventory_count,
          (
              SELECT MAX(l.id)
              FROM inventory l
              JOIN items it ON it.id = l.item_id
              WHERE l.machine_process_id = mp.id AND it.category = 'growth_run'
          ) AS growth_inventory_id,
          (
              SELECT MAX(l.status)
              FROM inventory l
              JOIN items it ON it.id = l.item_id
              WHERE l.machine_process_id = mp.id AND it.category = 'growth_run'
          ) AS growth_inventory_status
      FROM machines m
      JOIN machine_processes mp ON mp.machine_id = m.id
      WHERE mp.process_type = 'pr-01'
        AND mp.status = 'running'
        AND m.status = 'awaiting_output'
  )
  SELECT 
      *,
      (
          total_issues > 0 AND 
          open_issues = 0
      ) AS is_baseline,
      (
          total_issues > 0 AND 
          open_issues = 0 AND 
          all_issues_returned = true AND 
          null_remaining_issues = 0 AND 
          sum_remaining = 0 AND 
          total_returns > 0 AND 
          latest_return_created_at IS NOT NULL AND 
          growth_inventory_count = 1 AND 
          growth_inventory_status = 'IN STOCK' AND 
          completed_at IS NULL AND
          machine_code <> 'FB-M-01'
      ) AS is_strict
  FROM baseline
  WHERE total_issues > 0 AND open_issues = 0; -- Enforce baseline

  SELECT count(*) INTO v_baseline_count FROM stranded_candidates WHERE is_baseline = true;
  SELECT count(*) INTO v_strict_count FROM stranded_candidates WHERE is_strict = true;

  IF v_baseline_count = 0 THEN
      RAISE NOTICE 'No baseline stranded candidates found. Idempotent re-run successful.';
      RETURN;
  END IF;

  -- 2. Log excluded machines (baseline but not strict) — proceed with strict only
  v_excluded_count := v_baseline_count - v_strict_count;
  IF v_excluded_count > 0 THEN
      FOR v_rec IN SELECT * FROM stranded_candidates WHERE is_strict = false LOOP
          RAISE NOTICE 'EXCLUDED (will not be auto-reconciled): Machine % (Process ID: %). inv_count=%, inv_status=%, completed_at=%, is_fb_m_01=%',
              v_rec.machine_code, v_rec.machine_process_id,
              v_rec.growth_inventory_count, v_rec.growth_inventory_status, v_rec.completed_at, (v_rec.machine_code = 'FB-M-01');
      END LOOP;
      RAISE NOTICE 'phase66: % baseline candidates, % strict eligible, % excluded — proceeding with strict only', v_baseline_count, v_strict_count, v_excluded_count;
  END IF;

  IF v_strict_count = 0 THEN
      RAISE NOTICE 'No strict candidates to process. Exiting.';
      RETURN;
  END IF;

  -- Remove non-strict rows so all subsequent operations are scoped correctly
  DELETE FROM stranded_candidates WHERE is_strict = false;

  -- Multiple running candidates per machine check (among strict only)
  IF (SELECT count(machine_id) - count(DISTINCT machine_id) FROM stranded_candidates) > 0 THEN
      RAISE EXCEPTION 'phase66: multiple running candidates found for a single machine — aborting';
  END IF;

  -- 3. Lock in deterministic ID order (strict candidates only)
  PERFORM 1 FROM machine_processes WHERE id IN (SELECT machine_process_id FROM stranded_candidates) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM machines WHERE id IN (SELECT machine_id FROM stranded_candidates) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM lot_process_issues WHERE machine_process_id IN (SELECT machine_process_id FROM stranded_candidates) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM lot_process_returns WHERE issue_id IN (SELECT id FROM lot_process_issues WHERE machine_process_id IN (SELECT machine_process_id FROM stranded_candidates)) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM inventory WHERE id IN (SELECT growth_inventory_id FROM stranded_candidates) ORDER BY id FOR UPDATE;

  -- 4. Revalidate under lock (strict candidates only)
  FOR v_rec IN SELECT * FROM stranded_candidates LOOP
      IF NOT EXISTS (
          SELECT 1 FROM machine_processes mp
          JOIN machines m ON m.id = mp.machine_id
          WHERE mp.id = v_rec.machine_process_id
            AND mp.process_type = 'pr-01'
            AND mp.status = 'running'
            AND m.status = 'awaiting_output'
            AND mp.completed_at IS NULL
      ) THEN
          RAISE EXCEPTION 'phase66: revalidation failed for machine process % (status/completed_at changed)', v_rec.machine_process_id;
      END IF;

      IF (SELECT count(*) FROM lot_process_issues WHERE machine_process_id = v_rec.machine_process_id) <= 0 THEN
          RAISE EXCEPTION 'phase66: revalidation failed for machine process % (issue count not positive)', v_rec.machine_process_id;
      END IF;
      
      IF (SELECT count(*) FROM lot_process_issues WHERE machine_process_id = v_rec.machine_process_id AND status = 'OPEN') <> 0 THEN
          RAISE EXCEPTION 'phase66: revalidation failed for machine process % (open issue count changed)', v_rec.machine_process_id;
      END IF;
      
      IF NOT (SELECT bool_and(status = 'RETURNED') FROM lot_process_issues WHERE machine_process_id = v_rec.machine_process_id) THEN
          RAISE EXCEPTION 'phase66: revalidation failed for machine process % (not all issues returned)', v_rec.machine_process_id;
      END IF;

      IF (SELECT count(*) FROM lot_process_issues WHERE machine_process_id = v_rec.machine_process_id AND remaining_in_process IS NULL) > 0 THEN
          RAISE EXCEPTION 'phase66: revalidation failed for machine process % (null remaining found)', v_rec.machine_process_id;
      END IF;

      IF (SELECT COALESCE(SUM(remaining_in_process), -1) FROM lot_process_issues WHERE machine_process_id = v_rec.machine_process_id) <> 0 THEN
          RAISE EXCEPTION 'phase66: revalidation failed for machine process % (sum remaining != 0)', v_rec.machine_process_id;
      END IF;

      IF (SELECT count(ret.id) FROM lot_process_returns ret JOIN lot_process_issues i ON i.id = ret.issue_id WHERE i.machine_process_id = v_rec.machine_process_id) <= 0 THEN
          RAISE EXCEPTION 'phase66: revalidation failed for machine process % (return count not positive)', v_rec.machine_process_id;
      END IF;
      
      IF (SELECT MAX(ret.created_at) FROM lot_process_returns ret JOIN lot_process_issues i ON i.id = ret.issue_id WHERE i.machine_process_id = v_rec.machine_process_id) <> v_rec.latest_return_created_at THEN
          RAISE EXCEPTION 'phase66: revalidation failed for machine process % (return created_at changed)', v_rec.machine_process_id;
      END IF;

      IF (SELECT MAX(l.id) FROM inventory l JOIN items it ON it.id = l.item_id WHERE l.machine_process_id = v_rec.machine_process_id AND it.category = 'growth_run') <> v_rec.growth_inventory_id THEN
          RAISE EXCEPTION 'phase66: revalidation failed for machine process % (growth inventory ID changed)', v_rec.machine_process_id;
      END IF;

      IF (SELECT status FROM inventory WHERE id = v_rec.growth_inventory_id) <> 'IN STOCK' THEN
          RAISE EXCEPTION 'phase66: revalidation failed for machine process % (inventory status changed)', v_rec.machine_process_id;
      END IF;
  END LOOP;

  -- 5. Update exact captured machine processes (strict only)
  UPDATE machine_processes
  SET status = 'completed',
      completed_at = c.latest_return_created_at
  FROM stranded_candidates c
  WHERE machine_processes.id = c.machine_process_id;

  GET DIAGNOSTICS v_mp_updated = ROW_COUNT;
  IF v_mp_updated <> v_strict_count THEN
      RAISE EXCEPTION 'phase66: machine_process update count (%) <> candidate count (%)', v_mp_updated, v_strict_count;
  END IF;

  -- 6. Update exact captured machines (strict only)
  UPDATE machines
  SET status = 'idle'
  FROM stranded_candidates c
  WHERE machines.id = c.machine_id;

  GET DIAGNOSTICS v_m_updated = ROW_COUNT;
  IF v_m_updated <> v_strict_count THEN
      RAISE EXCEPTION 'phase66: machines update count (%) <> candidate count (%)', v_m_updated, v_strict_count;
  END IF;

  -- 7. Audit log insert
  INSERT INTO machine_status_logs (machine_id, old_status, new_status, changed_at, changed_by, remarks)
  SELECT 
      machine_id,
      'awaiting_output',
      'idle',
      v_execution_time,
      NULL,
      'LEGACY_PR01_OUTPUT_BASED_MACHINE_RELEASE_RECONCILIATION | MP_ID: ' || machine_process_id || ' | RETURN_CREATED_AT: ' || latest_return_created_at || ' | INV_ID: ' || growth_inventory_id
  FROM stranded_candidates;

  GET DIAGNOSTICS v_audit_inserted = ROW_COUNT;
  IF v_audit_inserted <> v_strict_count THEN
      RAISE EXCEPTION 'phase66: audit insert count (%) <> candidate count (%)', v_audit_inserted, v_strict_count;
  END IF;

  -- 8. Post-assertions: remaining stranded count should equal excluded count
  SELECT count(*) INTO v_post_baseline_count
  FROM machines m
  JOIN machine_processes mp ON mp.machine_id = m.id
  WHERE mp.process_type = 'pr-01'
    AND mp.status = 'running'
    AND m.status = 'awaiting_output'
    AND (
        SELECT count(*) FROM lot_process_issues WHERE machine_process_id = mp.id
    ) > 0
    AND (
        SELECT count(*) FROM lot_process_issues WHERE machine_process_id = mp.id AND status = 'OPEN'
    ) = 0;

  IF v_post_baseline_count > v_excluded_count THEN
      RAISE EXCEPTION 'phase66: post-baseline stranded count is % (expected at most %)', v_post_baseline_count, v_excluded_count;
  END IF;

  SELECT count(*) INTO v_ls01_updated FROM machine_status_logs WHERE machine_id = (SELECT id FROM machines WHERE code = 'FB-M-01') AND remarks LIKE '%LEGACY_PR01%';
  IF v_ls01_updated > 0 THEN
      RAISE EXCEPTION 'phase66: LS-01 / FB-M-01 was incorrectly reconciled!';
  END IF;

  RAISE NOTICE 'phase66: successfully released % stranded growth machines (% excluded for manual review)', v_strict_count, v_excluded_count;
END $$;

COMMIT;
