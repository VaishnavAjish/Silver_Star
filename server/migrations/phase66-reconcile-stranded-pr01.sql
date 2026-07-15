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
  v_re_run_check INTEGER;
  
  r RECORD;
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
              SELECT count(*) FROM lot_process_issues WHERE machine_process_id = mp.id AND status NOT IN ('RETURNED', 'CANCELLED')
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
              SELECT MAX(r.return_date)
              FROM lot_process_returns r
              JOIN lot_process_issues i ON i.id = r.issue_id
              WHERE i.machine_process_id = mp.id
          ) AS latest_return_date,
          (
              SELECT count(DISTINCT l.id)
              FROM lot_process_issues i
              JOIN inventory l ON l.id = i.lot_id
              JOIN items it ON it.id = l.item_id
              WHERE i.machine_process_id = mp.id AND it.category = 'growth_run'
          ) AS growth_inventory_count,
          (
              SELECT l.id
              FROM lot_process_issues i
              JOIN inventory l ON l.id = i.lot_id
              JOIN items it ON it.id = l.item_id
              WHERE i.machine_process_id = mp.id AND it.category = 'growth_run'
              LIMIT 1
          ) AS growth_inventory_id,
          (
              SELECT l.status
              FROM lot_process_issues i
              JOIN inventory l ON l.id = i.lot_id
              JOIN items it ON it.id = l.item_id
              WHERE i.machine_process_id = mp.id AND it.category = 'growth_run'
              LIMIT 1
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
          latest_return_date IS NOT NULL AND 
          growth_inventory_count = 1 AND 
          growth_inventory_status = 'IN STOCK' AND 
          completed_at IS NULL AND
          machine_code <> 'FB-M-01' -- Explicitly exclude LS-01
      ) AS is_strict
  FROM baseline
  WHERE total_issues > 0 AND open_issues = 0; -- Enforce baseline

  SELECT count(*) INTO v_baseline_count FROM stranded_candidates WHERE is_baseline = true;
  SELECT count(*) INTO v_strict_count FROM stranded_candidates WHERE is_strict = true;

  IF v_baseline_count = 0 THEN
      RAISE NOTICE 'No baseline stranded candidates found. Idempotent re-run successful.';
      RETURN;
  END IF;

  -- 2. Require baseline count = strict count
  IF v_baseline_count <> v_strict_count THEN
      -- Print exclusions
      FOR r IN SELECT * FROM stranded_candidates WHERE is_strict = false LOOP
          RAISE NOTICE 'Excluded Machine: % (Process ID: %). Reasons: all_returned=%, null_remaining=%, sum_rem=%, returns=%, return_date=%, inv_count=%, inv_status=%, completed_at=%, is_fb_m_01=%',
              r.machine_code, r.machine_process_id,
              r.all_issues_returned, r.null_remaining_issues, r.sum_remaining, r.total_returns,
              r.latest_return_date, r.growth_inventory_count, r.growth_inventory_status, r.completed_at, (r.machine_code = 'FB-M-01');
      END LOOP;
      RAISE EXCEPTION 'phase66: baseline count (%) does not match strict eligible count (%) — aborting', v_baseline_count, v_strict_count;
  END IF;
  
  -- Multiple running candidates per machine check
  SELECT count(machine_id) - count(DISTINCT machine_id) INTO v_excluded_count FROM stranded_candidates;
  IF v_excluded_count > 0 THEN
      RAISE EXCEPTION 'phase66: multiple running candidates found for a single machine — aborting';
  END IF;

  -- 3. Lock in deterministic ID order
  PERFORM 1 FROM machine_processes WHERE id IN (SELECT machine_process_id FROM stranded_candidates) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM machines WHERE id IN (SELECT machine_id FROM stranded_candidates) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM lot_process_issues WHERE machine_process_id IN (SELECT machine_process_id FROM stranded_candidates) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM lot_process_returns WHERE issue_id IN (SELECT id FROM lot_process_issues WHERE machine_process_id IN (SELECT machine_process_id FROM stranded_candidates)) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM inventory WHERE id IN (SELECT growth_inventory_id FROM stranded_candidates) ORDER BY id FOR UPDATE;

  -- 4. Revalidate under lock
  FOR r IN SELECT * FROM stranded_candidates LOOP
      -- Re-check issues, status, completed_at, inventory etc
      IF NOT EXISTS (
          SELECT 1 FROM machine_processes mp
          JOIN machines m ON m.id = mp.machine_id
          WHERE mp.id = r.machine_process_id
            AND mp.status = 'running'
            AND m.status = 'awaiting_output'
            AND mp.completed_at IS NULL
      ) THEN
          RAISE EXCEPTION 'phase66: revalidation failed for machine process % (status/completed_at changed)', r.machine_process_id;
      END IF;
      
      IF (SELECT MAX(ret.return_date) FROM lot_process_returns ret JOIN lot_process_issues i ON i.id = ret.issue_id WHERE i.machine_process_id = r.machine_process_id) <> r.latest_return_date THEN
          RAISE EXCEPTION 'phase66: revalidation failed for machine process % (return date changed)', r.machine_process_id;
      END IF;

      IF (SELECT status FROM inventory WHERE id = r.growth_inventory_id) <> 'IN STOCK' THEN
          RAISE EXCEPTION 'phase66: revalidation failed for machine process % (inventory status changed)', r.machine_process_id;
      END IF;
  END LOOP;

  -- 5. Update exact captured machine processes
  UPDATE machine_processes
  SET status = 'completed',
      completed_at = c.latest_return_date
  FROM stranded_candidates c
  WHERE machine_processes.id = c.machine_process_id;

  GET DIAGNOSTICS v_mp_updated = ROW_COUNT;
  IF v_mp_updated <> v_strict_count THEN
      RAISE EXCEPTION 'phase66: machine_process update count (%) <> candidate count (%)', v_mp_updated, v_strict_count;
  END IF;

  -- 6. Update exact captured machines
  UPDATE machines
  SET status = 'idle'
  FROM stranded_candidates c
  WHERE machines.id = c.machine_id;

  GET DIAGNOSTICS v_m_updated = ROW_COUNT;
  IF v_m_updated <> v_strict_count THEN
      RAISE EXCEPTION 'phase66: machines update count (%) <> candidate count (%)', v_m_updated, v_strict_count;
  END IF;

  -- 7. Audit log insert
  INSERT INTO machine_status_logs (machine_id, old_status, new_status, changed_at, remarks)
  SELECT 
      machine_id,
      'awaiting_output',
      'idle',
      NOW(),
      'LEGACY_PR01_OUTPUT_BASED_MACHINE_RELEASE_RECONCILIATION | MP_ID: ' || machine_process_id || ' | RETURN_TS: ' || latest_return_date || ' | INV_ID: ' || growth_inventory_id
  FROM stranded_candidates;

  GET DIAGNOSTICS v_audit_inserted = ROW_COUNT;
  IF v_audit_inserted <> v_strict_count THEN
      RAISE EXCEPTION 'phase66: audit insert count (%) <> candidate count (%)', v_audit_inserted, v_strict_count;
  END IF;

  -- 8. Post-assertions
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
        SELECT count(*) FROM lot_process_issues WHERE machine_process_id = mp.id AND status NOT IN ('RETURNED', 'CANCELLED')
    ) = 0;

  IF v_post_baseline_count > 0 THEN
      RAISE EXCEPTION 'phase66: post-baseline stranded count is % (expected 0)', v_post_baseline_count;
  END IF;

  SELECT count(*) INTO v_ls01_updated FROM machine_status_logs WHERE machine_id = (SELECT id FROM machines WHERE code = 'FB-M-01') AND remarks LIKE '%LEGACY_PR01%';
  IF v_ls01_updated > 0 THEN
      RAISE EXCEPTION 'phase66: LS-01 / FB-M-01 was incorrectly reconciled!';
  END IF;

  RAISE NOTICE 'phase66: successfully released % stranded growth machines', v_strict_count;
END $$;

COMMIT;
