-- ============================================================================
-- PHASE 70 — GUARDED GROWTH-AGAIN IDENTITY RECONCILIATION (220 / 493)
--
-- Purpose: collapse the duplicate Growth identity created when Growth Diamond
-- SSD013-APR26-011 (inventory 220) was re-issued to a GROWTH process and
-- the legacy Step 6 minted a NEW Partial Growth Run SSD001-JUL26-055
-- (inventory 493) for the SAME physical carrier. Root cause is fixed in
-- code (services/growthCarrier.js + routes/lotProcessIssues.js); this script
-- repairs the ONE frozen production pair.
--
-- End state (exactly ONE active physical carrier):
--   * 220 stays the active IN PROCESS carrier, Run advanced R1 → R2 (the
--     Growth Again that DID physically happen), wrong ATTACHED_TO_GROWTH
--     cleared. Identity, lot, Growth Number, root, qty, weight, value and
--     genealogy untouched.
--   * 493 neutralized per existing reversal conventions: CONSUMED +
--     RETIRED, qty/weight/value zeroed (it never carried value), detached
--     from the machine process so it can never resolve as a biscuit
--     candidate again. History rows are KEPT — no hard delete.
--   * Issue / machine_process / machine_process_lots already reference
--     220 (verified as a precondition) — nothing else is rewired.
--
-- Guarded: every precondition RAISES and ROLLS BACK the whole transaction.
-- Idempotent: a second run is a NOTICE no-op once the end state holds.
--
-- OWNER APPROVAL REQUIRED before running. Not applied automatically, never at
-- application startup. Run on EC2:
--   PGPASSWORD='...' psql -h <host> -U postgres -d silverstar_grow \
--     -f server/migrations/phase70-growth-again-identity-reconciliation.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

DO $$
DECLARE
  c_original_id  CONSTANT integer := 220;
  c_duplicate_id CONSTANT integer := 493;
  c_original_lot  CONSTANT text := 'SSD013-APR26-011';
  c_duplicate_lot CONSTANT text := 'SSD001-JUL26-055';

  v_orig RECORD;
  v_dup  RECORD;
  v_issue RECORD;
  v_cnt integer;
  v_updated integer;
BEGIN
  -- 1. Lock both inventory rows in deterministic id order (original < dup).
  SELECT inv.*, it.category INTO v_orig
  FROM inventory inv JOIN items it ON it.id = inv.item_id
  WHERE inv.id = c_original_id
  FOR UPDATE OF inv;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'phase70: original inventory % not found — aborting', c_original_id;
  END IF;

  SELECT inv.*, it.category INTO v_dup
  FROM inventory inv JOIN items it ON it.id = inv.item_id
  WHERE inv.id = c_duplicate_id
  FOR UPDATE OF inv;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'phase70: duplicate inventory % not found — aborting', c_duplicate_id;
  END IF;

  -- 2. Identity anchors — exact lots, exact categories.
  IF v_orig.lot_number <> c_original_lot THEN
    RAISE EXCEPTION 'phase70: inventory % lot_number is % (expected %) — aborting',
      c_original_id, v_orig.lot_number, c_original_lot;
  END IF;
  IF v_dup.lot_number <> c_duplicate_lot THEN
    RAISE EXCEPTION 'phase70: inventory % lot_number is % (expected %) — aborting',
      c_duplicate_id, v_dup.lot_number, c_duplicate_lot;
  END IF;
  IF v_orig.category <> 'growth_diamond' THEN
    RAISE EXCEPTION 'phase70: original category is % (expected growth_diamond) — aborting', v_orig.category;
  END IF;
  IF v_dup.category <> 'growth_run' THEN
    RAISE EXCEPTION 'phase70: duplicate category is % (expected growth_run) — aborting', v_dup.category;
  END IF;

  -- 3. IDEMPOTENCY: end state already holds → NOTICE no-op.
  IF v_dup.status = 'CONSUMED'
     AND v_dup.machine_process_id IS NULL
     AND COALESCE(v_dup.qty, 0) = 0
     AND COALESCE(v_orig.run_no, 0) = 2
     AND COALESCE(v_orig.manufacturing_state, '') <> 'ATTACHED_TO_GROWTH' THEN
    RAISE NOTICE 'phase70: pair %/% already reconciled — no-op', c_original_id, c_duplicate_id;
    RETURN;
  END IF;

  -- 4. FROZEN-STATE PRECONDITIONS (from the diagnostic snapshot).
  IF v_orig.status <> 'IN PROCESS' THEN
    RAISE EXCEPTION 'phase70: original status is % (expected IN PROCESS) — frozen state changed — aborting', v_orig.status;
  END IF;
  IF v_dup.status <> 'IN PROCESS' THEN
    RAISE EXCEPTION 'phase70: duplicate status is % (expected IN PROCESS) — frozen state changed — aborting', v_dup.status;
  END IF;
  IF COALESCE(v_orig.run_no, 0) <> 1 THEN
    RAISE EXCEPTION 'phase70: original run_no is % (expected 1) — frozen state changed — aborting', v_orig.run_no;
  END IF;
  IF v_orig.machine_process_id IS NULL
     OR v_dup.machine_process_id IS NULL
     OR v_orig.machine_process_id <> v_dup.machine_process_id THEN
    RAISE EXCEPTION 'phase70: rows are not linked to the same machine process (% vs %) — aborting',
      v_orig.machine_process_id, v_dup.machine_process_id;
  END IF;
  IF COALESCE(v_dup.total_value, 0) <> 0 THEN
    RAISE EXCEPTION 'phase70: duplicate carries non-zero value % — single-carrying-value assumption broken — aborting',
      v_dup.total_value;
  END IF;

  -- 5. The growth issue must already reference the ORIGINAL as its process lot
  --    (in-place issue) — then nothing needs rewiring. Anything else → manual.
  SELECT i.* INTO v_issue
  FROM lot_process_issues i
  WHERE i.machine_process_id = v_orig.machine_process_id
  ORDER BY i.id
  LIMIT 1
  FOR UPDATE OF i;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'phase70: no issue found on machine_process % — aborting', v_orig.machine_process_id;
  END IF;
  IF v_issue.process_lot_id IS DISTINCT FROM c_original_id THEN
    RAISE EXCEPTION 'phase70: issue % process_lot_id is % (expected %) — manual review required — aborting',
      v_issue.issue_number, v_issue.process_lot_id, c_original_id;
  END IF;

  -- 6. DOWNSTREAM-ACTIVITY GUARDS on the duplicate — all must be ZERO.
  SELECT count(*) INTO v_cnt FROM lot_process_issues
   WHERE source_lot_id = c_duplicate_id OR process_lot_id = c_duplicate_id;
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'phase70: duplicate referenced by % issue(s) — downstream activity — aborting', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt FROM lot_process_returns WHERE lot_id = c_duplicate_id;
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'phase70: duplicate referenced by % return row(s) — downstream activity — aborting', v_cnt;
  END IF;
  -- Guard: growth_run_cycles may not exist yet on production — check safely.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE tablename = 'growth_run_cycles') THEN
    EXECUTE 'SELECT count(*) FROM growth_run_cycles WHERE growth_run_id = $1' INTO v_cnt USING c_duplicate_id;
    IF v_cnt > 0 THEN
      RAISE EXCEPTION 'phase70: duplicate has % growth cycle(s) — downstream activity — aborting', v_cnt;
    END IF;
  END IF;
  -- Guard: lot_mix_components may not exist — check safely.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE tablename = 'lot_mix_components') THEN
    EXECUTE 'SELECT count(*) FROM lot_mix_components WHERE mixed_lot_id = $1 OR source_lot_id = $1'
      INTO v_cnt USING c_duplicate_id;
    IF v_cnt > 0 THEN
      RAISE EXCEPTION 'phase70: duplicate has % mix component link(s) — downstream activity — aborting', v_cnt;
    END IF;
  END IF;
  SELECT count(*) INTO v_cnt FROM inventory
   WHERE parent_lot_id = c_duplicate_id
      OR (root_lot_id = c_duplicate_id AND id <> c_duplicate_id);
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'phase70: duplicate has % child lot(s) — downstream activity — aborting', v_cnt;
  END IF;
  -- Guard: machine_process_lots may not exist — check safely.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE tablename = 'machine_process_lots') THEN
    EXECUTE 'SELECT count(*) FROM machine_process_lots WHERE inventory_lot_id = $1' INTO v_cnt USING c_duplicate_id;
    IF v_cnt > 0 THEN
      RAISE EXCEPTION 'phase70: duplicate linked in % machine_process_lots row(s) — downstream activity — aborting', v_cnt;
    END IF;
  END IF;
  SELECT count(*) INTO v_cnt FROM lot_op_log
   WHERE lot_id = c_duplicate_id AND operation <> 'growth_run_created';
  IF v_cnt > 0 THEN
    RAISE EXCEPTION 'phase70: duplicate has % op-log entrie(s) beyond creation — downstream activity — aborting', v_cnt;
  END IF;

  -- 7. REPAIR — original: Run R1 → R2, clear the wrong seed attachment.
  --    Identity, qty, weight, value, dims and genealogy are NOT touched.
  UPDATE inventory
     SET run_no = 2,
         manufacturing_state = CASE WHEN manufacturing_state = 'ATTACHED_TO_GROWTH'
                                    THEN NULL ELSE manufacturing_state END,
         updated_at = NOW()
   WHERE id = c_original_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'phase70: expected to update original exactly once, updated % — aborting', v_updated;
  END IF;

  -- 8. REPAIR — duplicate: neutralize per existing reversal conventions
  --    (CONSUMED + RETIRED, zeroed, detached). History rows are kept.
  UPDATE inventory
     SET status = 'CONSUMED',
         manufacturing_state = 'RETIRED',
         qty = 0, weight = 0, total_value = 0,
         machine_process_id = NULL,
         remarks = COALESCE(remarks || ' | ', '')
                   || 'GROWTH_AGAIN_IDENTITY_RECONCILIATION: duplicate of '
                   || c_original_lot || ' (inventory ' || c_original_id || ')',
         updated_at = NOW()
   WHERE id = c_duplicate_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'phase70: expected to update duplicate exactly once, updated % — aborting', v_updated;
  END IF;

  -- 9. AUDIT — one reconciliation record per row (traceability, no deletes).
  INSERT INTO lot_op_log
    (lot_id, operation, reference_type, reference_id, qty_delta, new_status, notes, performed_by)
  VALUES
    (c_original_id, 'growth_again_identity_reconciliation', 'machine_process',
     v_orig.machine_process_id, 0, 'IN PROCESS',
     'GROWTH_AGAIN_IDENTITY_RECONCILIATION | carrier ' || c_original_lot
       || ' confirmed as the single Growth identity; Run R1 -> R2; wrong '
       || 'ATTACHED_TO_GROWTH cleared; duplicate ' || c_duplicate_lot
       || ' (inventory ' || c_duplicate_id || ') neutralized', NULL),
    (c_duplicate_id, 'growth_again_identity_reconciliation', 'machine_process',
     v_orig.machine_process_id, 0, 'CONSUMED',
     'GROWTH_AGAIN_IDENTITY_RECONCILIATION | duplicate identity of '
       || c_original_lot || ' (inventory ' || c_original_id
       || ') — neutralized (CONSUMED/RETIRED, zeroed, detached); history kept', NULL);
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 2 THEN
    RAISE EXCEPTION 'phase70: audit insert count % <> 2 — aborting', v_updated;
  END IF;

  -- 10. POSTCONDITIONS — exactly ONE active carrier on the machine process.
  SELECT count(*) INTO v_cnt
  FROM inventory inv JOIN items it ON it.id = inv.item_id
  WHERE inv.machine_process_id = v_orig.machine_process_id
    AND it.category IN ('growth_run', 'growth_diamond')
    AND inv.status = 'IN PROCESS';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'phase70: post-assertion failed — % active carrier(s) on machine_process % (expected 1) — aborting',
      v_cnt, v_orig.machine_process_id;
  END IF;
  PERFORM 1 FROM inventory
   WHERE id = c_original_id AND status = 'IN PROCESS' AND run_no = 2
     AND COALESCE(manufacturing_state, '') <> 'ATTACHED_TO_GROWTH';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'phase70: post-assertion failed — original % not IN PROCESS/R2/detached — aborting', c_original_id;
  END IF;
  PERFORM 1 FROM inventory
   WHERE id = c_duplicate_id AND status = 'CONSUMED' AND machine_process_id IS NULL
     AND qty = 0 AND weight = 0 AND total_value = 0;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'phase70: post-assertion failed — duplicate % not neutralized — aborting', c_duplicate_id;
  END IF;

  RAISE NOTICE 'phase70: reconciled — % is the single active carrier (R2, IN PROCESS); % neutralized (history kept)',
    c_original_lot, c_duplicate_lot;
END $$;

COMMIT;
