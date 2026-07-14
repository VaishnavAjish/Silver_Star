-- ============================================================
-- Phase 60: Growth Return Reversal (additive, DATA-SAFE)
-- ============================================================
-- Adds reversal support to lot_process_returns:
--   status          — ACTIVE | REVERSED (original rows stay visible forever)
--   reversed_by/at  — who / when
--   reversal_reason — mandatory reason (immutable audit)
--   pre_state       — JSONB snapshot captured AT RETURN TIME by the biscuit
--                     branch of POST /:id/return. This is the "smallest
--                     snapshot addition": growth_run_cycles stores only
--                     prev_weight/prev_height (not length/width), and the
--                     consumed seed process lot's qty/weight/value are stored
--                     nowhere else — so reliable restoration requires this
--                     snapshot. It is NULL for every non-biscuit return.
--
-- HARD DEPLOY COUPLING: the Phase-60 server code INSERTs pre_state and reads
-- pr.status in the history endpoint — apply this migration BEFORE or WITH the
-- code deploy. No production biscuit-route returns exist yet (smoke pending),
-- so every reversible return will carry its snapshot.
--
-- Idempotent. DO NOT AUTO-RUN. Apply manually on EC2:
--   psql -U postgres -d silverstar_grow -f phase60-growth-return-reversal.sql

BEGIN;

ALTER TABLE lot_process_returns
  ADD COLUMN IF NOT EXISTS status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS reversed_by     INT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reversed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
  ADD COLUMN IF NOT EXISTS pre_state       JSONB;

CREATE INDEX IF NOT EXISTS idx_lpr_status ON lot_process_returns(status);

-- Verification (visual)
SELECT column_name FROM information_schema.columns
WHERE table_name = 'lot_process_returns'
  AND column_name IN ('status', 'reversed_by', 'reversed_at', 'reversal_reason', 'pre_state')
ORDER BY column_name;

COMMIT;

-- ── ROLLBACK (manual — columns are additive; dropping loses reversal audit) ──
-- BEGIN;
-- ALTER TABLE lot_process_returns
--   DROP COLUMN IF EXISTS pre_state,
--   DROP COLUMN IF EXISTS reversal_reason,
--   DROP COLUMN IF EXISTS reversed_at,
--   DROP COLUMN IF EXISTS reversed_by,
--   DROP COLUMN IF EXISTS status;
-- DROP INDEX IF EXISTS idx_lpr_status;
-- COMMIT;
