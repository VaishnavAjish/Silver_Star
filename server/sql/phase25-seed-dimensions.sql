-- ============================================================
-- SILVERSTAR GROW — Phase 25: Lot Operational ID + Seed Dimensions
-- Run AFTER phase24-process-lifecycle.sql
-- pg_dump first: pg_dump -U postgres silverstar_grow > backup_pre_phase25.sql
-- Apply: psql -U postgres -d silverstar_grow -f sql/phase25-seed-dimensions.sql
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ── Sequence for Lot Operational ID (6-digit+, barcode-ready) ─────────────────
-- Starts at 100001 to guarantee 6 digits from the very first ID.
CREATE SEQUENCE IF NOT EXISTS lot_op_id_seq START 100001;

-- ── New columns on inventory ──────────────────────────────────────────────────

-- Barcode-ready unique operational identity (different from internal id and lot_code)
ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS lot_op_id  BIGINT;

-- Measurement dimensions (seed inventory only; nullable for non-seed lots)
ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS dim_length NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS dim_depth  NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS dim_height NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS dim_unit   VARCHAR(10) DEFAULT 'mm';

-- ── Backfill: assign lot_op_id to all existing rows ───────────────────────────
-- Each existing physical lot entity gets a unique ID.
-- Order by id so the assignment is stable and deterministic.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM inventory WHERE lot_op_id IS NULL ORDER BY id LOOP
    UPDATE inventory
    SET lot_op_id = nextval('lot_op_id_seq')
    WHERE id = r.id;
  END LOOP;
END $$;

-- ── Enforce NOT NULL + UNIQUE after backfill ──────────────────────────────────
ALTER TABLE inventory ALTER COLUMN lot_op_id SET NOT NULL;

-- UNIQUE constraint (idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_lot_op_id_key' AND conrelid = 'inventory'::regclass
  ) THEN
    ALTER TABLE inventory ADD CONSTRAINT inventory_lot_op_id_key UNIQUE (lot_op_id);
  END IF;
END $$;

-- ── Validation check constraints ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inventory_dim_length_nonneg' AND conrelid = 'inventory'::regclass
  ) THEN
    ALTER TABLE inventory
      ADD CONSTRAINT inventory_dim_length_nonneg CHECK (dim_length IS NULL OR dim_length >= 0),
      ADD CONSTRAINT inventory_dim_depth_nonneg  CHECK (dim_depth  IS NULL OR dim_depth  >= 0),
      ADD CONSTRAINT inventory_dim_height_nonneg CHECK (dim_height IS NULL OR dim_height >= 0);
  END IF;
END $$;

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inventory_lot_op_id ON inventory(lot_op_id);
