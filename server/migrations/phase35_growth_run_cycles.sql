-- ============================================================
-- Phase 35: Growth Run Cycle History
-- ------------------------------------------------------------
-- RULE 5 — persistent growth-cycle history for a Growth Run (biscuit).
--
-- A single Growth Run inventory row (category='growth_run') lives through many
-- measurement-changing events: the initial growth, "Growth Again" re-grows, and
-- laser cuts (Edge/Outer/Block/Seed Remove/Growth Cut). Each event must be
-- preserved WITHOUT overwriting the previous one, so total growth can be
-- reconstructed:
--     Cycle 1 = +2.10   (seed 0.40 → 2.50)
--     Cycle 2 = +1.40   (2.50 → 3.90)
--     Total   = +3.50
--
-- This is an APPEND-ONLY ledger keyed to the biscuit's inventory id. It does NOT
-- replace lot_op_log (which is the generic audit trail) - it is the structured,
-- queryable per-cycle measurement record. Display can come later — data is
-- preserved now.
--
-- Safe to re-run (IF NOT EXISTS guards). No agriculture growth_cycles table is
-- touched — that is an unrelated crop-tracking table.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS growth_run_cycles (
  id                  SERIAL PRIMARY KEY,
  growth_run_id       INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  machine_process_id  INTEGER REFERENCES machine_processes(id),
  cycle_no            INTEGER NOT NULL,
  process_type        VARCHAR(40),            -- growth, edge_cut, outer_cut, ...
  prev_height         NUMERIC(10,3),
  new_height          NUMERIC(10,3),
  growth_mm           NUMERIC(10,3),          -- per-cycle delta = new_height - prev_height
  prev_weight         NUMERIC(12,4),
  new_weight          NUMERIC(12,4),
  weight_delta        NUMERIC(12,4),          -- new_weight - prev_weight
  dim_length          NUMERIC(10,3),
  dim_width           NUMERIC(10,3),
  dim_unit            VARCHAR(8) DEFAULT 'mm',
  remarks             TEXT,
  performed_by        INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (growth_run_id, cycle_no)
);

CREATE INDEX IF NOT EXISTS idx_growth_run_cycles_run
  ON growth_run_cycles(growth_run_id);

CREATE INDEX IF NOT EXISTS idx_growth_run_cycles_process
  ON growth_run_cycles(machine_process_id)
  WHERE machine_process_id IS NOT NULL;

COMMIT;

-- ── Validation ────────────────────────────────────────────────────────────────
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'growth_run_cycles'
  ) THEN 'OK — growth_run_cycles table present'
  ELSE 'FAIL — growth_run_cycles missing'
  END AS table_check;
