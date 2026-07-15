-- ============================================================
-- Phase 63 — Final Block Process Master normalization (release-scoped)
-- ============================================================
-- DO NOT AUTO-RUN. Apply manually on EC2, BEFORE phase64:
--   psql $DATABASE_URL -f phase63-reconcile-legacy-processes.sql
--
-- SCOPE (deliberately minimal for this release):
--   Rename the single existing Final Block Process Master row
--   (process_code = 'pr-06') in place to 'final_block', preserving its
--   primary-key id and every historical reference to it. Nothing else.
--
-- This migration MUST NOT touch any other process. Full Process Master
-- duplicate stabilization (pr-01..pr-05 vs growth/edge_cut/block_cut/
-- outer_cut/seed_remove, growth_cut, cutting) is OUT OF SCOPE and is
-- deferred by owner decision. In particular it never modifies, renames,
-- deactivates, merges or deletes block_cut, growth_cut, growth, or
-- pr-01..pr-05.
--
-- The schema stores historical process references as process-code TEXT
-- (process_type), NOT as a process_master foreign key. Before renaming pr-06
-- (Case A) this migration AUDITS every confirmed transactional table that
-- resolves a process by code and ABORTS if any direct reference to 'pr-06'
-- exists — it never rewrites history and never renames a still-referenced
-- process. Audited identity-resolution columns (not free-text notes):
--   · lot_process_issues.process_type    (direct)
--   · machine_processes.process_type     (direct)
--   · growth_run_cycles.process_type     (direct, per-cycle history)
--   · lot_process_returns → issue_id → lot_process_issues.process_type (indirect)
-- lot_op_log.notes and similar free-text audit fields are deliberately NOT
-- audited — they do not participate in Process Master identity resolution.
-- Each table is probed with to_regclass so a table absent in some environment
-- is skipped rather than raising a spurious error.
--
-- Guarded, transaction-safe, idempotent. Explicit about expected row counts;
-- aborts (rolls back) on any unexpected state rather than guessing.
-- No hard-coded numeric database IDs.

BEGIN;

DO $$
DECLARE
  v_pr06_count  INTEGER;
  v_final_count INTEGER;
  v_ref_issues  INTEGER := 0;
  v_ref_machine INTEGER := 0;
  v_ref_cycles  INTEGER := 0;
  v_ref_returns INTEGER := 0;
BEGIN
  SELECT count(*) INTO v_pr06_count  FROM process_master WHERE process_code = 'pr-06';
  SELECT count(*) INTO v_final_count FROM process_master WHERE process_code = 'final_block';

  -- Case E — duplicate rows for either code: abort, report the count.
  IF v_pr06_count > 1 THEN
    RAISE EXCEPTION 'phase63: expected at most one pr-06 row, found % — aborting', v_pr06_count;
  END IF;
  IF v_final_count > 1 THEN
    RAISE EXCEPTION 'phase63: expected at most one final_block row, found % — aborting', v_final_count;
  END IF;

  -- Case C — both codes present: never merge, delete, or rewrite history.
  IF v_pr06_count = 1 AND v_final_count = 1 THEN
    RAISE EXCEPTION 'phase63: both pr-06 and final_block exist — refusing to merge or delete; manual reconciliation required';
  END IF;

  -- Case D — neither code present: do not invent a process; abort.
  IF v_pr06_count = 0 AND v_final_count = 0 THEN
    RAISE EXCEPTION 'phase63: neither pr-06 nor final_block exists — nothing to normalize; refusing to invent a process';
  END IF;

  -- Case B — already migrated (final_block only): idempotent no-op.
  IF v_pr06_count = 0 AND v_final_count = 1 THEN
    RAISE NOTICE 'phase63: final_block already present and pr-06 absent — idempotent no-op';
    RETURN;
  END IF;

  -- Case A — exactly one pr-06, zero final_block.
  -- Reference guard: renaming the process_code orphans any transactional row
  -- that resolves the process by code. Count DIRECT references in every
  -- confirmed identity-resolution table and ABORT if any exist. This runs
  -- ONLY on the rename path — Case B (already migrated) never reaches here and
  -- so never requires stale pr-06 references to be zero to rerun.
  IF to_regclass('lot_process_issues') IS NOT NULL THEN
    EXECUTE $q$ SELECT count(*) FROM lot_process_issues WHERE process_type = 'pr-06' $q$ INTO v_ref_issues;
  END IF;
  IF to_regclass('machine_processes') IS NOT NULL THEN
    EXECUTE $q$ SELECT count(*) FROM machine_processes WHERE process_type = 'pr-06' $q$ INTO v_ref_machine;
  END IF;
  IF to_regclass('growth_run_cycles') IS NOT NULL THEN
    EXECUTE $q$ SELECT count(*) FROM growth_run_cycles WHERE process_type = 'pr-06' $q$ INTO v_ref_cycles;
  END IF;
  IF to_regclass('lot_process_returns') IS NOT NULL AND to_regclass('lot_process_issues') IS NOT NULL THEN
    EXECUTE $q$ SELECT count(*) FROM lot_process_returns r
                JOIN lot_process_issues i ON i.id = r.issue_id
                WHERE i.process_type = 'pr-06' $q$ INTO v_ref_returns;
  END IF;

  IF v_ref_issues > 0 OR v_ref_machine > 0 OR v_ref_cycles > 0 OR v_ref_returns > 0 THEN
    RAISE EXCEPTION 'phase63: pr-06 still has transactional references — refusing to rename (no historical rewrite). lot_process_issues=%, machine_processes=%, growth_run_cycles=%, lot_process_returns=%',
      v_ref_issues, v_ref_machine, v_ref_cycles, v_ref_returns;
  END IF;

  -- No live references: rename in place. Same row, same primary-key id; only
  -- the Final Block record's own code/name/group are normalized.
  UPDATE process_master
  SET process_code          = 'final_block',
      process_name          = 'Final Block',
      process_group         = 'LASER',
      eligible_machine_type = 'LASER',
      active                = true,
      sort_order            = 57
  WHERE process_code = 'pr-06';

  RAISE NOTICE 'phase63: renamed pr-06 -> final_block in place (primary-key id preserved)';
END $$;

COMMIT;

-- Verification (manual, after applying):
--   SELECT id, process_code, process_name, process_group, active
--   FROM process_master WHERE process_code IN ('pr-06','final_block');
-- Expect exactly ONE final_block row, ZERO pr-06 rows; its id equals the
-- pr-06 id recorded by the pre-deploy read-only query. block_cut and
-- growth_cut rows are untouched.
