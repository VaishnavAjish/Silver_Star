-- ============================================================
-- SILVERSTAR GROW — Seed Lot Genealogy System
-- Run AFTER phase5-lot-movements.sql
-- pg_dump first: pg_dump -U postgres silverstar_grow > backup_pre_seed_genealogy.sql
-- Apply: psql -U postgres -d silverstar_grow -f sql/phase-seed-genealogy.sql
-- Idempotent: safe to run multiple times.
-- ============================================================

-- ── Sequences ─────────────────────────────────────────────────────────────────

-- Seed purchase lot codes: 1001, 1002, 1003 ...
CREATE SEQUENCE IF NOT EXISTS seed_lot_seq START 1001;

-- Seed mix lot codes: MX0001, MX0002 ...
CREATE SEQUENCE IF NOT EXISTS seed_mix_seq START 1;

-- ── New columns on inventory ──────────────────────────────────────────────────

ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS lot_code        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS parent_lot_id   INTEGER REFERENCES inventory(id),
  ADD COLUMN IF NOT EXISTS root_lot_id     INTEGER REFERENCES inventory(id),
  ADD COLUMN IF NOT EXISTS operation_type  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS split_level     INTEGER,
  ADD COLUMN IF NOT EXISTS genealogy_path  TEXT;

-- ── New table: mix component tracking ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lot_mix_components (
  id            SERIAL PRIMARY KEY,
  mixed_lot_id  INTEGER NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
  source_lot_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE RESTRICT,
  qty           NUMERIC(15,4) NOT NULL CHECK (qty > 0),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mixed_lot_id, source_lot_id)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_inventory_lot_code    ON inventory(lot_code);
CREATE INDEX IF NOT EXISTS idx_inventory_parent_lot  ON inventory(parent_lot_id);
CREATE INDEX IF NOT EXISTS idx_inventory_root_lot    ON inventory(root_lot_id);
CREATE INDEX IF NOT EXISTS idx_lmc_mixed_lot         ON lot_mix_components(mixed_lot_id);
CREATE INDEX IF NOT EXISTS idx_lmc_source_lot        ON lot_mix_components(source_lot_id);

-- ── Backfill existing seed lots ───────────────────────────────────────────────
-- Existing seed lots keep their old lot_number as lot_code for backward compat.
-- split_level = 0 for all existing lots (level is unknown for legacy data).
-- operation_type derived from source_type where available.

UPDATE inventory inv
SET
  lot_code       = inv.lot_number,
  operation_type = CASE
    WHEN inv.source_type = 'split'  THEN 'split'
    WHEN inv.source_type = 'mix'    THEN 'mix'
    WHEN inv.source_type = 'growth' THEN 'purchase'
    ELSE 'purchase'
  END,
  split_level    = 0,
  genealogy_path = inv.lot_number
FROM items i
WHERE inv.item_id = i.id
  AND i.category  = 'seed'
  AND inv.lot_code IS NULL;
