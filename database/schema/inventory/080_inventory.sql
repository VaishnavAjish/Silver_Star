CREATE TYPE inv_transaction_type AS ENUM ('purchase_receipt', 'sales_issue', 'transfer_in', 'transfer_out', 'adjustment_add', 'adjustment_sub', 'return');

CREATE TABLE stock_batches (
  id            SERIAL PRIMARY KEY,
  batch_no      VARCHAR(30) NOT NULL,
  item_id       INTEGER NOT NULL REFERENCES items(id),
  quantity      NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_price    NUMERIC(12,2) DEFAULT 0,
  mfg_date      DATE,
  exp_date      DATE,
  location_id   INTEGER REFERENCES locations(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_batch_item ON stock_batches(item_id);

CREATE TABLE inventory_transactions (
  id              SERIAL PRIMARY KEY,
  transaction_no  VARCHAR(20) UNIQUE NOT NULL,
  transaction_type inv_transaction_type NOT NULL,
  item_id         INTEGER NOT NULL REFERENCES items(id),
  batch_id        INTEGER REFERENCES stock_batches(id),
  quantity        NUMERIC(12,2) NOT NULL,
  unit_price      NUMERIC(12,2),
  total_price     NUMERIC(15,2),
  reference_type  VARCHAR(30),
  reference_id    INTEGER,
  location_id     INTEGER REFERENCES locations(id),
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_inv_trans_item     ON inventory_transactions(item_id);
CREATE INDEX idx_inv_trans_type     ON inventory_transactions(transaction_type);
CREATE INDEX idx_inv_trans_date     ON inventory_transactions(created_at);
CREATE INDEX idx_inv_trans_ref      ON inventory_transactions(reference_type, reference_id);
