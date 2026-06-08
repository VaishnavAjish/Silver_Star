CREATE TYPE output_type AS ENUM ('rough_diamond', 'polished_diamond', 'seed', 'gas', 'byproduct');

CREATE TABLE production_batches (
  id                SERIAL PRIMARY KEY,
  batch_no          VARCHAR(30) UNIQUE NOT NULL,
  process_date      DATE NOT NULL,
  department_id     INTEGER REFERENCES departments(id),
  machine_id        INTEGER REFERENCES machines(id),
  supervisor_id     INTEGER REFERENCES users(id),
  output_type       output_type NOT NULL,
  input_quantity    NUMERIC(12,2) DEFAULT 0,
  output_quantity   NUMERIC(12,2) DEFAULT 0,
  waste_quantity    NUMERIC(12,2) DEFAULT 0,
  status            VARCHAR(20) DEFAULT 'planned',
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_prod_batch_date ON production_batches(process_date);
CREATE INDEX idx_prod_batch_dept ON production_batches(department_id);

CREATE TABLE production_batch_items (
  id              SERIAL PRIMARY KEY,
  batch_id        INTEGER NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  item_id         INTEGER NOT NULL REFERENCES items(id),
  quantity        NUMERIC(12,2) NOT NULL,
  unit_price      NUMERIC(12,2),
  total_price     NUMERIC(15,2),
  type            VARCHAR(10) NOT NULL CHECK (type IN ('input', 'output', 'waste')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_prod_batch_items_batch ON production_batch_items(batch_id);
