-- ============================================================================
-- CONTROL TOWER STATE CLASSIFICATION — READ-ONLY (awaiting_output retirement)
-- Run on EC2:  node server/run-inspection.js server/sql/control-tower-state-classification.sql
--        or :  psql -U postgres -d silverstar_grow -f server/sql/control-tower-state-classification.sql
-- Makes NO changes: read-only transaction, finishes with ROLLBACK.
--
-- Classifies every machine against the canonical derived-state model
-- (services/machineStateModel.js). Feeds the guarded reconciliation in
-- CONTROL-TOWER-PRODUCTION-RUNBOOK.md — NOTHING here repairs data.
-- ============================================================================

BEGIN TRANSACTION READ ONLY;

-- ── 1. Full machine classification ───────────────────────────────────────────
WITH active_mp AS (
  SELECT mp.*, ROW_NUMBER() OVER (
           PARTITION BY mp.machine_id
           ORDER BY CASE mp.status WHEN 'running' THEN 1 ELSE 2 END, mp.id DESC
         ) AS rn
  FROM machine_processes mp
  WHERE mp.status IN ('running','hold')
),
issue_agg AS (
  SELECT machine_process_id,
         COUNT(*) FILTER (WHERE status = 'OPEN'
                            AND COALESCE(remaining_in_process, 0) > 0.0001) AS open_returnable,
         COUNT(*) FILTER (WHERE status = 'OPEN') AS open_any
  FROM lot_process_issues
  GROUP BY machine_process_id
)
SELECT 'MACHINE_CLASSIFICATION' AS section,
       m.id, m.code, m.status AS machine_status,
       amp.id AS machine_process_id, amp.status AS mp_status, amp.process_type,
       COALESCE(ia.open_returnable, 0) AS open_returnable,
       (SELECT COUNT(*) FROM active_mp a2 WHERE a2.machine_id = m.id) AS active_mp_count,
       CASE
         WHEN m.status::text IN ('maintenance','breakdown','cleaning') THEN 'PROTECTED_OVERRIDE'
         WHEN (SELECT COUNT(*) FROM active_mp a2 WHERE a2.machine_id = m.id) > 1
                                                                    THEN 'AMBIGUOUS_DUPLICATE_ACTIVE'
         WHEN amp.id IS NOT NULL AND ia.machine_process_id IS NULL  THEN 'AMBIGUOUS_MISSING_ISSUE'
         WHEN amp.id IS NOT NULL AND m.status::text IN ('running','hold')
                                                                    THEN 'VALID_RUNNING'
         WHEN amp.id IS NOT NULL                                    THEN 'ACTIVE_PROCESS_WRONG_MACHINE_STATUS'
         WHEN m.status::text = 'awaiting_output'                    THEN 'STALE_AWAITING_OUTPUT'
         WHEN m.status::text = 'idle'                               THEN 'VALID_AVAILABLE'
         ELSE 'REVIEW'
       END AS classification
FROM machines m
LEFT JOIN active_mp amp ON amp.machine_id = m.id AND amp.rn = 1
LEFT JOIN issue_agg ia  ON ia.machine_process_id = amp.id
ORDER BY 12, m.code;

-- ── 2. Stale machine candidates (reconciliation targets) ─────────────────────
-- machines.status = 'awaiting_output' with NO active machine_process: after
-- code deploy these render as NEEDS REVIEW; guarded reconciliation moves them
-- to idle (guard: zero active processes at UPDATE time).
SELECT 'STALE_AWAITING_OUTPUT_CANDIDATES' AS section,
       m.id, m.code, m.name, m.status,
       (SELECT MAX(mp.completed_at) FROM machine_processes mp
         WHERE mp.machine_id = m.id AND mp.status = 'completed') AS last_completed_at
FROM machines m
WHERE m.status::text = 'awaiting_output'
  AND NOT EXISTS (SELECT 1 FROM machine_processes mp
                   WHERE mp.machine_id = m.id AND mp.status IN ('running','hold'))
ORDER BY m.code;

-- ── 3. Completed process with OPEN issue (SSD-056 shape — never returnable) ──
SELECT 'COMPLETED_PROCESS_OPEN_ISSUE' AS section,
       lpi.id AS issue_id, lpi.issue_number, lpi.status,
       COALESCE(lpi.remaining_in_process, lpi.issued_qty) AS remaining,
       mp.id AS machine_process_id, mp.status AS mp_status, mp.completed_at
FROM lot_process_issues lpi
JOIN machine_processes mp ON mp.id = lpi.machine_process_id
WHERE mp.status IN ('completed','cancelled')
  AND lpi.status = 'OPEN'
  AND COALESCE(lpi.remaining_in_process, lpi.issued_qty) > 0.0001
ORDER BY mp.completed_at DESC NULLS LAST;

ROLLBACK;
