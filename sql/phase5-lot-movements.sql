-- ============================================================
-- SILVERSTAR GROW — Phase 5: Lot Split & Mix
-- Run AFTER phase4-fixed-assets.sql
-- pg_dump first: pg_dump -U postgres silverstar_grow > backup_pre_phase5.sql
-- Apply: psql -U postgres -d silverstar_grow -f sql/phase5-lot-movements.sql
-- ============================================================

-- ── Lot movement type ────────────────────────────────────────────────────────
CREATE TYPE lot_movement_type AS ENUM ('split', 'mix');

-- ── Auto-number sequence (LM-YYYYMM-NNNN) ────────────────────────────────────
CREATE SEQUENCE lm_seq START 1;

-- ── Movement header ──────────────────────────────────────────────────────────
CREATE TABLE lot_movements (
  id               SERIAL PRIMARY KEY,
  movement_number  VARCHAR(20) UNIQUE NOT NULL,
  movement_type    lot_movement_type NOT NULL,
  movement_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  notes            TEXT,
  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Parent (consumed) lots ───────────────────────────────────────────────────
-- quantity_consumed = weight (ct) for rough lots, qty (pcs) for others
CREATE TABLE lot_movement_parents (
  id                SERIAL PRIMARY KEY,
  movement_id       INTEGER NOT NULL REFERENCES lot_movements(id) ON DELETE RESTRICT,
  parent_lot_id     INTEGER NOT NULL REFERENCES inventory(id)     ON DELETE RESTRICT,
  quantity_consumed NUMERIC(15,4) NOT NULL CHECK (quantity_consumed > 0),
  cost_per_unit     NUMERIC(15,4) NOT NULL,
  UNIQUE(movement_id, parent_lot_id)
);

-- ── Child (created) lots ─────────────────────────────────────────────────────
CREATE TABLE lot_movement_children (
  id            SERIAL PRIMARY KEY,
  movement_id   INTEGER NOT NULL REFERENCES lot_movements(id) ON DELETE RESTRICT,
  child_lot_id  INTEGER NOT NULL REFERENCES inventory(id)     ON DELETE RESTRICT,
  quantity      NUMERIC(15,4) NOT NULL CHECK (quantity > 0),
  cost_per_unit NUMERIC(15,4) NOT NULL,
  UNIQUE(movement_id, child_lot_id)
);

CREATE INDEX idx_lmp_parent ON lot_movement_parents(parent_lot_id);
CREATE INDEX idx_lmc_child  ON lot_movement_children(child_lot_id);
CREATE INDEX idx_lm_date    ON lot_movements(movement_date);
CREATE INDEX idx_lm_type    ON lot_movements(movement_type);

-- ── Lineage columns on inventory ─────────────────────────────────────────────
ALTER TABLE inventory
  ADD COLUMN source_movement_id INTEGER REFERENCES lot_movements(id),
  ADD COLUMN source_type VARCHAR(20);  -- 'purchase' | 'growth' | 'split' | 'mix'

-- ── Invariant trigger: value and quantity must balance ────────────────────────
-- Fires DEFERRED at COMMIT so all child rows are visible before the check runs.
CREATE OR REPLACE FUNCTION check_lot_movement_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_p_val  NUMERIC;
  v_c_val  NUMERIC;
  v_p_qty  NUMERIC;
  v_c_qty  NUMERIC;
BEGIN
  SELECT COALESCE(SUM(quantity_consumed * cost_per_unit), 0),
         COALESCE(SUM(quantity_consumed), 0)
  INTO v_p_val, v_p_qty
  FROM lot_movement_parents
  WHERE movement_id = NEW.movement_id;

  SELECT COALESCE(SUM(quantity * cost_per_unit), 0),
         COALESCE(SUM(quantity), 0)
  INTO v_c_val, v_c_qty
  FROM lot_movement_children
  WHERE movement_id = NEW.movement_id;

  -- Only check once both sides are fully populated
  IF v_p_qty > 0 AND v_c_qty > 0 THEN
    IF ABS(v_p_qty - v_c_qty) > 0.0001 THEN
      RAISE EXCEPTION
        'Lot movement % quantity mismatch: parents=% children=%',
        NEW.movement_id, v_p_qty, v_c_qty;
    END IF;
    -- ₹0.01 tolerance absorbs weighted-average rounding
    IF ABS(v_p_val - v_c_val) > 0.01 THEN
      RAISE EXCEPTION
        'Lot movement % value mismatch: parents=% children=%',
        NEW.movement_id, v_p_val, v_c_val;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_lot_movement_balance
  AFTER INSERT OR UPDATE ON lot_movement_children
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_lot_movement_balance();
