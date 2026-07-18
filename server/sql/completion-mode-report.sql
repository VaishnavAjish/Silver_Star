-- ============================================================================
-- COMPLETION-MODE REPORT — READ-ONLY (single completion engine, Phase B)
-- Run on EC2:  node server/run-inspection.js server/sql/completion-mode-report.sql
--        or :  psql -U postgres -d silverstar_grow -f server/sql/completion-mode-report.sql
-- Makes NO changes: read-only transaction, finishes with ROLLBACK.
-- ============================================================================

BEGIN TRANSACTION READ ONLY;

-- ── 1. Every Process Master record and its completion configuration ──────────
SELECT 'PROCESS_MASTER_MODES' AS section,
       id, process_code, process_name, process_group, active, completion_mode,
       updated_at
FROM process_master
ORDER BY active DESC, process_group, sort_order, process_code;

-- ── 2. Active processes that would still use legacy OUTPUT_BASED completion ──
-- Growth-group rows are listed for visibility but are ALREADY Return-engine
-- owned in code (completionEngineGuard: Growth never uses legacy completion).
SELECT 'ACTIVE_OUTPUT_BASED' AS section,
       process_code, process_name, process_group, completion_mode
FROM process_master
WHERE active = true AND completion_mode = 'OUTPUT_BASED'
ORDER BY process_group, process_code;

-- ── 3. LIVE machine_processes whose process is OUTPUT_BASED ──────────────────
-- Non-empty here = a legitimate legacy caller still exists; the generic
-- OUTPUT_BASED branch must NOT be retired until this is empty (or reconciled).
SELECT 'LIVE_OUTPUT_BASED_PROCESSES' AS section,
       mp.id AS machine_process_id, mp.process_number, mp.process_type,
       mp.status, m.code AS machine_code,
       pm.process_group, pm.completion_mode
FROM machine_processes mp
JOIN machines m ON m.id = mp.machine_id
LEFT JOIN process_master pm ON pm.process_code = mp.process_type
WHERE mp.status IN ('running','hold')
  AND COALESCE(pm.completion_mode, 'RETURN_BASED') = 'OUTPUT_BASED'
ORDER BY mp.id;

-- ── 4. pr-01 doctrine check (expected RETURN_BASED after phase65) ─────────────
SELECT 'PR01_DOCTRINE' AS section,
       process_code, process_name, process_group, completion_mode,
       CASE WHEN completion_mode = 'RETURN_BASED'
            THEN 'OK — phase65 applied'
            ELSE 'PENDING — run phase65-pr01-completion-mode.sql' END AS verdict
FROM process_master
WHERE process_code = 'pr-01';

ROLLBACK;
