-- ============================================================================
-- PHASE 71 — SSD-100 GUARDED MACHINE RELEASE (PI-202607-0385 / inventory 100594)
--
-- PREPARED, NOT EXECUTED. Run ONLY after reviewing
--   server/sql/ssd100-growth-again-diagnostic.sql
-- and ONLY when its CLASSIFICATION is FULL_RETURN_MACHINE_CACHE_STALE (Case A)
-- or MACHINE_PROCESS_NOT_COMPLETED (Case B). Every other classification
-- (ISSUE_NOT_COMPLETED, wrong linkage, duplicates, ambiguous) makes this
-- script ABORT with no change.
--
-- Idempotent: when the process is already completed and the machine already
-- idle it exits as a clean no-op.
--
-- NEVER touches: inventory (id 100594 or any other row), lot_process_returns,
-- lot_process_issues, run_no, quantities, weights, dimensions, value,
-- genealogy, or any other machine.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_machine_id     INTEGER;
  v_machine_status TEXT;
  v_issue          RECORD;
  v_mp             RECORD;
  v_active_cnt     INTEGER;
  v_open_siblings  INTEGER;
  v_final_returns  INTEGER;
  v_return_ts      TIMESTAMPTZ;
  v_inv_status     TEXT;
  v_rows           INTEGER;
BEGIN
  -- ── Resolve the fixed production case ─────────────────────────────────────
  SELECT id, status::text INTO v_machine_id, v_machine_status
  FROM machines WHERE code = 'CVD-M-100';
  IF v_machine_id IS NULL THEN
    RAISE EXCEPTION 'phase71: machine CVD-M-100 not found — aborting';
  END IF;

  SELECT * INTO v_issue FROM lot_process_issues WHERE issue_number = 'PI-202607-0385';
  IF v_issue.id IS NULL THEN
    RAISE EXCEPTION 'phase71: issue PI-202607-0385 not found — aborting';
  END IF;
  IF v_issue.machine_process_id IS NULL THEN
    RAISE EXCEPTION 'phase71: issue has no machine_process linkage (RETURN_LINKED_TO_WRONG_MACHINE_PROCESS) — manual review required, aborting';
  END IF;

  SELECT * INTO v_mp FROM machine_processes WHERE id = v_issue.machine_process_id FOR UPDATE;
  IF v_mp.id IS NULL THEN
    RAISE EXCEPTION 'phase71: linked machine_process % not found — aborting', v_issue.machine_process_id;
  END IF;
  IF v_mp.machine_id IS DISTINCT FROM v_machine_id THEN
    RAISE EXCEPTION 'phase71: linked machine_process % belongs to machine %, not CVD-M-100 — aborting',
      v_mp.id, v_mp.machine_id;
  END IF;

  -- ── Shared proofs (both cases) ─────────────────────────────────────────────
  IF v_issue.status <> 'RETURNED' OR COALESCE(v_issue.remaining_in_process, 1) > 0.0001 THEN
    RAISE EXCEPTION 'phase71: ISSUE_NOT_COMPLETED (status=%, remaining=%) — no automatic repair, aborting',
      v_issue.status, v_issue.remaining_in_process;
  END IF;

  SELECT COUNT(*) INTO v_final_returns
  FROM lot_process_returns WHERE issue_id = v_issue.id AND is_final = true;
  IF v_final_returns <> 1 THEN
    RAISE EXCEPTION 'phase71: expected exactly one final Return for the issue, found % — aborting', v_final_returns;
  END IF;
  SELECT MAX(created_at) INTO v_return_ts
  FROM lot_process_returns WHERE issue_id = v_issue.id AND is_final = true;

  SELECT status INTO v_inv_status FROM inventory WHERE id = v_issue.process_lot_id;
  IF v_inv_status IS DISTINCT FROM 'IN STOCK' THEN
    RAISE EXCEPTION 'phase71: inventory % is % (expected IN STOCK) — aborting', v_issue.process_lot_id, COALESCE(v_inv_status, '<NULL>');
  END IF;

  SELECT COUNT(*) INTO v_open_siblings
  FROM lot_process_issues
  WHERE machine_process_id = v_mp.id AND status = 'OPEN'
    AND COALESCE(remaining_in_process, issued_qty) > 0.0001;
  IF v_open_siblings > 0 THEN
    RAISE EXCEPTION 'phase71: % open sibling issue(s) with remaining quantity — aborting', v_open_siblings;
  END IF;

  SELECT COUNT(*) INTO v_active_cnt
  FROM machine_processes WHERE machine_id = v_machine_id AND status IN ('running','hold');

  IF v_machine_status IN ('maintenance','breakdown','cleaning') THEN
    RAISE EXCEPTION 'phase71: machine is in protected state % — aborting', v_machine_status;
  END IF;

  -- ── Case B — MACHINE_PROCESS_NOT_COMPLETED ────────────────────────────────
  IF v_mp.status IN ('running','hold') THEN
    IF v_active_cnt <> 1 THEN
      RAISE EXCEPTION 'phase71: MULTIPLE_OR_CONFLICTING_MACHINE_PROCESSES (active=%) — aborting', v_active_cnt;
    END IF;

    UPDATE machine_processes
       SET status = 'completed',
           completed_at = COALESCE(v_return_ts, NOW()),
           paused_at = NULL
     WHERE id = v_mp.id AND status IN ('running','hold');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'phase71: expected to complete exactly one machine_process, updated % — aborting', v_rows;
    END IF;

    UPDATE machines SET status = 'idle' WHERE id = v_machine_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'phase71: expected to release exactly one machine, updated % — aborting', v_rows;
    END IF;

    INSERT INTO machine_status_logs (machine_id, old_status, new_status, changed_by, remarks)
    VALUES (v_machine_id, v_machine_status, 'idle', NULL,
      'phase71 reconciliation (Case B): PI-202607-0385 fully returned; completed machine_process '
      || v_mp.id || ' with completed_at = final Return timestamp and released SSD-100');

    RAISE NOTICE 'phase71: Case B applied — machine_process % completed at %, SSD-100 released to idle',
      v_mp.id, COALESCE(v_return_ts, NOW());
    RETURN;
  END IF;

  -- ── Case A — FULL_RETURN_MACHINE_CACHE_STALE ──────────────────────────────
  IF v_mp.status = 'completed' AND v_mp.completed_at IS NOT NULL THEN
    IF v_active_cnt <> 0 THEN
      RAISE EXCEPTION 'phase71: machine_process completed but % other active process(es) exist — MULTIPLE_OR_CONFLICTING, aborting', v_active_cnt;
    END IF;
    IF v_machine_status = 'idle' THEN
      RAISE NOTICE 'phase71: machine already idle and process completed — nothing to repair (idempotent no-op)';
      RETURN;
    END IF;
    IF v_machine_status <> 'running' THEN
      RAISE EXCEPTION 'phase71: unexpected machine status % for Case A — aborting', v_machine_status;
    END IF;

    UPDATE machines SET status = 'idle' WHERE id = v_machine_id AND status::text = 'running';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'phase71: expected to release exactly one machine, updated % — aborting', v_rows;
    END IF;

    INSERT INTO machine_status_logs (machine_id, old_status, new_status, changed_by, remarks)
    VALUES (v_machine_id, 'running', 'idle', NULL,
      'phase71 reconciliation (Case A): stale running cache cleared — PI-202607-0385 fully returned, machine_process '
      || v_mp.id || ' already completed at ' || v_mp.completed_at);

    RAISE NOTICE 'phase71: Case A applied — stale running cache cleared, SSD-100 released to idle';
    RETURN;
  END IF;

  RAISE EXCEPTION 'phase71: AMBIGUOUS_MANUAL_REVIEW (mp status=%, completed_at=%) — aborting',
    v_mp.status, v_mp.completed_at;
END $$;

COMMIT;
