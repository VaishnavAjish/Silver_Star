-- ============================================================
-- Phase 27: Manufacturing Control Tower
-- Run ONCE: psql $DATABASE_URL -f phase27_manufacturing_control_tower.sql
-- Safe to re-run (IF NOT EXISTS / IF EXISTS guards).
-- ============================================================
-- NOTE: machines.status is an existing PostgreSQL ENUM type called
--       machine_status. Existing values: idle, running, maintenance.
--       We extend it with: hold, breakdown, completed, cleaning.
-- ============================================================

BEGIN;

-- ── Extend the existing machine_status ENUM ──────────────────────────────────
-- ADD VALUE is non-transactional in PostgreSQL, so each must be its own
-- statement outside of a sub-transaction. We use IF NOT EXISTS (Pg 9.6+).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'machine_status'::regtype
      AND enumlabel = 'hold'
  ) THEN
    ALTER TYPE machine_status ADD VALUE 'hold';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'machine_status'::regtype
      AND enumlabel = 'breakdown'
  ) THEN
    ALTER TYPE machine_status ADD VALUE 'breakdown';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'machine_status'::regtype
      AND enumlabel = 'completed'
  ) THEN
    ALTER TYPE machine_status ADD VALUE 'completed';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumtypid = 'machine_status'::regtype
      AND enumlabel = 'cleaning'
  ) THEN
    ALTER TYPE machine_status ADD VALUE 'cleaning';
  END IF;
END $$;

-- ── 1. machine_processes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS machine_processes (
  id                     SERIAL PRIMARY KEY,
  process_number         VARCHAR(30) UNIQUE NOT NULL,
  machine_id             INTEGER NOT NULL REFERENCES machines(id),
  operator_id            INTEGER REFERENCES users(id),
  process_type           VARCHAR(50) NOT NULL DEFAULT 'growth',
  status                 VARCHAR(20) NOT NULL DEFAULT 'running'
                         CHECK (status IN ('running','hold','completed','cancelled')),
  started_at             TIMESTAMP NOT NULL DEFAULT NOW(),
  paused_at              TIMESTAMP,
  completed_at           TIMESTAMP,
  target_runtime_hours   NUMERIC(6,2),
  expected_completion_at TIMESTAMP,
  total_paused_minutes   NUMERIC(8,2) DEFAULT 0,
  expected_rough_qty     NUMERIC(10,3),
  expected_height        NUMERIC(8,3),
  remarks                TEXT,
  created_by             INTEGER REFERENCES users(id),
  created_at             TIMESTAMP DEFAULT NOW()
);

-- ── 2. machine_process_lots ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS machine_process_lots (
  id               SERIAL PRIMARY KEY,
  process_id       INTEGER NOT NULL REFERENCES machine_processes(id) ON DELETE CASCADE,
  inventory_lot_id INTEGER NOT NULL REFERENCES inventory(id),
  issued_qty       NUMERIC(10,3) DEFAULT 0,
  issued_weight    NUMERIC(10,4) DEFAULT 0,
  returned_qty     NUMERIC(10,3) DEFAULT 0,
  damaged_qty      NUMERIC(10,3) DEFAULT 0,
  consumed_qty     NUMERIC(10,3) DEFAULT 0
);

-- ── 3. machine_process_materials ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS machine_process_materials (
  id            SERIAL PRIMARY KEY,
  process_id    INTEGER NOT NULL REFERENCES machine_processes(id) ON DELETE CASCADE,
  material_id   INTEGER REFERENCES inventory(id),
  material_name VARCHAR(100),
  qty           NUMERIC(10,4),
  unit          VARCHAR(20)
);

-- ── 4. machine_status_logs ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS machine_status_logs (
  id          SERIAL PRIMARY KEY,
  machine_id  INTEGER NOT NULL REFERENCES machines(id),
  old_status  VARCHAR(20),
  new_status  VARCHAR(20) NOT NULL,
  changed_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  changed_by  INTEGER REFERENCES users(id),
  remarks     TEXT
);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mp_machine_id   ON machine_processes(machine_id);
CREATE INDEX IF NOT EXISTS idx_mp_status       ON machine_processes(status);
CREATE INDEX IF NOT EXISTS idx_mp_operator_id  ON machine_processes(operator_id);
CREATE INDEX IF NOT EXISTS idx_mp_started_at   ON machine_processes(started_at);
CREATE INDEX IF NOT EXISTS idx_mpl_process_id  ON machine_process_lots(process_id);
CREATE INDEX IF NOT EXISTS idx_mpm_process_id  ON machine_process_materials(process_id);
CREATE INDEX IF NOT EXISTS idx_msl_machine_id  ON machine_status_logs(machine_id);
CREATE INDEX IF NOT EXISTS idx_msl_changed_at  ON machine_status_logs(changed_at);

COMMIT;
