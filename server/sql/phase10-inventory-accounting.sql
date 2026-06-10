-- ============================================================
-- SILVERSTAR GROW - Phase 10: Inventory Accounting & P&L COGS
-- Run AFTER all previous phase schemas.
-- ============================================================

BEGIN;

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS quantity_on_hand NUMERIC(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_cost NUMERIC(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_purchase_cost NUMERIC(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inventory_value NUMERIC(15,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS inventory_opening (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity NUMERIC(15,4) NOT NULL CHECK (quantity > 0),
  rate NUMERIC(15,4) NOT NULL CHECK (rate > 0),
  value NUMERIC(15,2) NOT NULL CHECK (value > 0),
  as_of_date DATE NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(item_id, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_inventory_opening_date ON inventory_opening(as_of_date);
CREATE INDEX IF NOT EXISTS idx_inventory_opening_item ON inventory_opening(item_id);

CREATE TABLE IF NOT EXISTS inventory_closing_override (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity NUMERIC(15,4) NOT NULL CHECK (quantity >= 0),
  rate NUMERIC(15,4) NOT NULL CHECK (rate >= 0),
  value NUMERIC(15,2) NOT NULL CHECK (value >= 0),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(date, item_id)
);

CREATE INDEX IF NOT EXISTS idx_inventory_closing_date ON inventory_closing_override(date);
CREATE INDEX IF NOT EXISTS idx_inventory_closing_item ON inventory_closing_override(item_id);

DROP TRIGGER IF EXISTS trg_inventory_closing_override_updated ON inventory_closing_override;
CREATE TRIGGER trg_inventory_closing_override_updated
  BEFORE UPDATE ON inventory_closing_override
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Backfill item-level summary valuation from current inventory lots.
UPDATE items i
SET quantity_on_hand = COALESCE(s.qty, 0),
    inventory_value = COALESCE(s.value, 0),
    avg_cost = CASE WHEN COALESCE(s.qty, 0) > 0 THEN ROUND((s.value / s.qty)::numeric, 4) ELSE 0 END,
    last_purchase_cost = COALESCE(s.last_rate, 0)
FROM (
  SELECT item_id,
         SUM(CASE WHEN category = 'rough' THEN COALESCE(weight, qty, 0) ELSE COALESCE(qty, 0) END) AS qty,
         SUM(COALESCE(total_value, 0)) AS value,
         (ARRAY_AGG(rate ORDER BY purchase_date DESC NULLS LAST, inv.id DESC))[1] AS last_rate
  FROM inventory inv
  JOIN items it ON it.id = inv.item_id
  WHERE inv.status NOT IN ('SOLD', 'CONSUMED', 'CANCELLED')
  GROUP BY item_id
) s
WHERE i.id = s.item_id;

COMMIT;
