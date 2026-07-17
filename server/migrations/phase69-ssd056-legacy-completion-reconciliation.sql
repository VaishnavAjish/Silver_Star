-- ============================================================================
-- PHASE 69 — GUARDED SSD-056 LEGACY-COMPLETION RECONCILIATION
--
-- Purpose: align ONE Process Issue that the retired Control Tower "Complete
-- Process" path left OPEN/returnable, even though its machine_process was
-- already completed and its Growth output was already posted (IN STOCK).
--
-- Anchor (exact, not display text): Process Issue PI-202607-0325
--   Growth Number SSD056-JUL26-043 · Run R1 · issued 24 PCS.
--
-- This script:
--   * updates ONLY the issue completion fields (remaining_in_process, status);
--   * inserts ONE audit row (LEGACY_CONTROL_TOWER_COMPLETION_RECONCILIATION);
--   * creates NO inventory, NO lot, NO Return row, moves NO stock, releases NO
--     machine again, changes NO weight/dimension/value/genealogy.
--
-- Returned-qty is derived from issue columns (issued_qty − remaining_in_process),
-- NOT from summing lot_process_returns rows, so NO Return row is required and
-- creating one would risk a double count. See ssd056-inconsistency-audit.sql.
--
-- Idempotent: a second run is a no-op once the issue is RETURNED / remaining 0.
-- Guarded: any failed precondition RAISES and the whole transaction ROLLS BACK.
--
-- OWNER APPROVAL REQUIRED before running. Not applied automatically, never at
-- application startup. Run on EC2:
--   psql -U postgres -d silverstar_grow -f server/migrations/phase69-ssd056-legacy-completion-reconciliation.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10s';

DO $$
DECLARE
  c_issue_number    CONSTANT text    := 'PI-202607-0325';
  c_expected_qty    CONSTANT numeric := 24;
  c_expected_growth CONSTANT text    := 'SSD056-JUL26-043';
  c_expected_run    CONSTANT integer := 1;

  v_issue          RECORD;
  v_match_count    integer;
  v_growth_count   integer;
  v_return_count   integer;
  v_updated        integer;
  v_audit_inserted integer;
BEGIN
  -- 1. Exactly one issue matches the anchor.
  SELECT count(*) INTO v_match_count
  FROM lot_process_issues WHERE issue_number = c_issue_number;
  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'phase69: expected exactly one issue %, found % — aborting', c_issue_number, v_match_count;
  END IF;

  -- 2. Lock the issue + its machine_process in deterministic order.
  SELECT lpi.id, lpi.status, lpi.issued_qty, lpi.remaining_in_process,
         lpi.machine_process_id, lpi.process_lot_id, lpi.source_lot_id,
         mp.status AS mp_status, mp.completed_at AS mp_completed_at, mp.machine_id
    INTO v_issue
  FROM lot_process_issues lpi
  JOIN machine_processes mp ON mp.id = lpi.machine_process_id
  WHERE lpi.issue_number = c_issue_number
  FOR UPDATE OF lpi, mp;

  -- 3. IDEMPOTENCY: already reconciled → do nothing.
  IF v_issue.status = 'RETURNED'
     AND COALESCE(v_issue.remaining_in_process, 0) = 0 THEN
    RAISE NOTICE 'phase69: issue % already reconciled (RETURNED, remaining 0) — no-op', c_issue_number;
    RETURN;
  END IF;

  -- 4. PRECONDITIONS — every one must hold, else abort.
  IF v_issue.status <> 'OPEN' THEN
    RAISE EXCEPTION 'phase69: issue % status is % (expected OPEN) — aborting', c_issue_number, v_issue.status;
  END IF;
  IF ABS(v_issue.issued_qty - c_expected_qty) > 0.0001 THEN
    RAISE EXCEPTION 'phase69: issue % issued_qty % <> expected % — aborting', c_issue_number, v_issue.issued_qty, c_expected_qty;
  END IF;
  IF ABS(COALESCE(v_issue.remaining_in_process, v_issue.issued_qty) - c_expected_qty) > 0.0001 THEN
    RAISE EXCEPTION 'phase69: issue % remaining % <> unreconciled % — aborting', c_issue_number, v_issue.remaining_in_process, c_expected_qty;
  END IF;
  IF v_issue.mp_status <> 'completed' THEN
    RAISE EXCEPTION 'phase69: linked machine_process status is % (expected completed) — aborting', v_issue.mp_status;
  END IF;
  IF v_issue.mp_completed_at IS NULL THEN
    RAISE EXCEPTION 'phase69: linked machine_process completed_at is NULL — cannot prove completion — aborting';
  END IF;

  -- 5. Growth output already posted EXACTLY once, IN STOCK, on the same process,
  --    matching Growth Number + Run.
  SELECT count(*) INTO v_growth_count
  FROM inventory g
  JOIN items it ON it.id = g.item_id
  WHERE g.machine_process_id = v_issue.machine_process_id
    AND it.category = 'growth_run';
  IF v_growth_count <> 1 THEN
    RAISE EXCEPTION 'phase69: expected exactly one growth output on mp %, found % — aborting', v_issue.machine_process_id, v_growth_count;
  END IF;

  PERFORM 1
  FROM inventory g
  JOIN items it ON it.id = g.item_id
  WHERE g.machine_process_id = v_issue.machine_process_id
    AND it.category = 'growth_run'
    AND g.status = 'IN STOCK'
    AND g.lot_number = c_expected_growth
    AND COALESCE(g.run_no, -1) = c_expected_run;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'phase69: growth output not IN STOCK or growth-number/run mismatch (expected % R%) — aborting', c_expected_growth, c_expected_run;
  END IF;

  -- 6. No canonical Return already exists for this issue (no double-count).
  SELECT count(*) INTO v_return_count
  FROM lot_process_returns WHERE issue_id = v_issue.id;
  IF v_return_count <> 0 THEN
    RAISE EXCEPTION 'phase69: issue % already has % canonical Return row(s) — aborting', c_issue_number, v_return_count;
  END IF;

  -- 7. REPAIR — issue completion fields ONLY. No inventory/return/machine writes.
  UPDATE lot_process_issues
     SET remaining_in_process = 0,
         status = 'RETURNED',
         updated_at = NOW()
   WHERE id = v_issue.id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'phase69: expected to update exactly one issue, updated % — aborting', v_updated;
  END IF;

  -- 8. AUDIT — one dedicated reconciliation record (traceability).
  INSERT INTO lot_op_log
    (lot_id, operation, reference_type, reference_id, qty_delta, new_status, notes, performed_by)
  VALUES
    (COALESCE(v_issue.process_lot_id, v_issue.source_lot_id),
     'legacy_completion_reconciliation',
     'machine_process',
     v_issue.machine_process_id,
     0,
     'RETURNED',
     'LEGACY_CONTROL_TOWER_COMPLETION_RECONCILIATION | ISSUE: ' || c_issue_number
       || ' | MP: ' || v_issue.machine_process_id
       || ' | GROWTH: ' || c_expected_growth || ' R' || c_expected_run
       || ' | COMPLETED_AT: ' || v_issue.mp_completed_at
       || ' | QTY: ' || c_expected_qty,
     NULL);
  GET DIAGNOSTICS v_audit_inserted = ROW_COUNT;
  IF v_audit_inserted <> 1 THEN
    RAISE EXCEPTION 'phase69: audit insert count % <> 1 — aborting', v_audit_inserted;
  END IF;

  -- 9. POSTCONDITIONS — prove the intended end state.
  PERFORM 1 FROM lot_process_issues
   WHERE id = v_issue.id AND status = 'RETURNED'
     AND COALESCE(remaining_in_process, 0) = 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'phase69: post-assertion failed — issue % not RETURNED/zero — aborting', c_issue_number;
  END IF;

  RAISE NOTICE 'phase69: reconciled issue % (mp %, growth % R%) — issue closed, no inventory/return created',
    c_issue_number, v_issue.machine_process_id, c_expected_growth, c_expected_run;
END $$;

COMMIT;
