CREATE TYPE po_status AS ENUM ('draft', 'ordered', 'partially_received', 'received', 'cancelled');

CREATE TABLE purchase_orders (
  id              SERIAL PRIMARY KEY,
  po_number       VARCHAR(20) UNIQUE NOT NULL,
  vendor_id       INTEGER NOT NULL REFERENCES vendors(id),
  order_date      DATE NOT NULL,
  expected_date   DATE,
  status          po_status DEFAULT 'draft',
  subtotal        NUMERIC(15,2) DEFAULT 0,
  tax_amount      NUMERIC(15,2) DEFAULT 0,
  discount_amount NUMERIC(15,2) DEFAULT 0,
  total_amount    NUMERIC(15,2) DEFAULT 0,
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id),
  approved_by     INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_po_vendor ON purchase_orders(vendor_id);
CREATE INDEX idx_po_status ON purchase_orders(status);
CREATE INDEX idx_po_date   ON purchase_orders(order_date);

CREATE TABLE po_items (
  id              SERIAL PRIMARY KEY,
  po_id           INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id         INTEGER NOT NULL REFERENCES items(id),
  quantity        NUMERIC(12,2) NOT NULL,
  received_qty    NUMERIC(12,2) DEFAULT 0,
  unit_price      NUMERIC(12,2) NOT NULL,
  total_price     NUMERIC(15,2) NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_po_items_po   ON po_items(po_id);
CREATE INDEX idx_po_items_item ON po_items(item_id);
