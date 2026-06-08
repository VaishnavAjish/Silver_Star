CREATE TYPE sales_order_status AS ENUM ('draft', 'confirmed', 'shipped', 'invoiced', 'cancelled');

CREATE TABLE sales_orders (
  id              SERIAL PRIMARY KEY,
  so_number       VARCHAR(20) UNIQUE NOT NULL,
  customer_name   VARCHAR(150) NOT NULL,
  customer_gstin  VARCHAR(22),
  order_date      DATE NOT NULL,
  delivery_date   DATE,
  status          sales_order_status DEFAULT 'draft',
  subtotal        NUMERIC(15,2) DEFAULT 0,
  tax_amount      NUMERIC(15,2) DEFAULT 0,
  discount_amount NUMERIC(15,2) DEFAULT 0,
  total_amount    NUMERIC(15,2) DEFAULT 0,
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_so_date   ON sales_orders(order_date);
CREATE INDEX idx_so_status ON sales_orders(status);

CREATE TABLE so_items (
  id          SERIAL PRIMARY KEY,
  so_id       INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES items(id),
  quantity    NUMERIC(12,2) NOT NULL,
  unit_price  NUMERIC(12,2) NOT NULL,
  total_price NUMERIC(15,2) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_so_items_so   ON so_items(so_id);
CREATE INDEX idx_so_items_item ON so_items(item_id);
