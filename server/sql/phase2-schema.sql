-- ============================================================
-- SILVERSTAR GROW — Phase 2 Schema (Add to existing Phase 1)
-- Run AFTER schema.sql and seed-data.sql
-- ============================================================

-- ============================================================
-- INVENTORY (tracks current stock of all raw materials)
-- ============================================================
CREATE TABLE inventory (
  id            SERIAL PRIMARY KEY,
  item_id       INTEGER NOT NULL REFERENCES items(id),
  lot_number    VARCHAR(30) UNIQUE NOT NULL,
  lot_name      VARCHAR(100),
  batch_no      VARCHAR(30),
  qty           NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit          VARCHAR(10) DEFAULT 'PCS',
  weight        NUMERIC(12,4) DEFAULT 0,
  rate          NUMERIC(12,2) DEFAULT 0,
  total_value   NUMERIC(15,2) DEFAULT 0,
  location_id   INTEGER REFERENCES locations(id),
  department_id INTEGER REFERENCES departments(id),
  vendor_id     INTEGER REFERENCES vendors(id),
  purchase_date DATE,
  last_used     DATE,
  status        VARCHAR(20) DEFAULT 'IN STOCK',  -- IN STOCK, IN PROCESS, CONSUMED, LOW STOCK
  remarks       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inventory_item ON inventory(item_id);
CREATE INDEX idx_inventory_status ON inventory(status);
CREATE INDEX idx_inventory_lot ON inventory(lot_number);

-- ============================================================
-- PURCHASE NOTES
-- ============================================================
CREATE TYPE doc_status AS ENUM ('draft', 'open', 'closed', 'cancelled');

CREATE TABLE purchase_notes (
  id              SERIAL PRIMARY KEY,
  doc_number      VARCHAR(20) UNIQUE NOT NULL,
  doc_date        DATE NOT NULL,
  vendor_id       INTEGER REFERENCES vendors(id),
  item_type       VARCHAR(30),         -- seed, gas, consumable, other
  department_id   INTEGER REFERENCES departments(id),
  payment_term    VARCHAR(30) DEFAULT 'Immediate',
  currency        VARCHAR(3) DEFAULT 'INR',
  reference_no    VARCHAR(50),
  remark          TEXT,
  total_qty       NUMERIC(12,2) DEFAULT 0,
  total_amount    NUMERIC(15,2) DEFAULT 0,
  tax_amount      NUMERIC(12,2) DEFAULT 0,
  grand_total     NUMERIC(15,2) DEFAULT 0,
  je_id           INTEGER REFERENCES journal_entries(id),
  status          doc_status DEFAULT 'draft',
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE SEQUENCE pn_seq START 2050;

CREATE TABLE purchase_note_lines (
  id              SERIAL PRIMARY KEY,
  purchase_note_id INTEGER NOT NULL REFERENCES purchase_notes(id) ON DELETE CASCADE,
  line_no         INTEGER DEFAULT 1,
  item_id         INTEGER REFERENCES items(id),
  description     TEXT,
  batch_no        VARCHAR(30),
  qty             NUMERIC(12,2) NOT NULL,
  unit            VARCHAR(10) DEFAULT 'PCS',
  rate            NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount          NUMERIC(15,2) DEFAULT 0,
  tax_pct         NUMERIC(5,2) DEFAULT 0,
  tax_amount      NUMERIC(12,2) DEFAULT 0,
  total           NUMERIC(15,2) DEFAULT 0,
  inventory_id    INTEGER REFERENCES inventory(id),  -- links to created inventory record
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pn_lines_pn ON purchase_note_lines(purchase_note_id);

-- ============================================================
-- EXPENSES
-- ============================================================
CREATE TABLE expenses (
  id              SERIAL PRIMARY KEY,
  doc_number      VARCHAR(20) UNIQUE NOT NULL,
  date            DATE NOT NULL,
  category_id     INTEGER REFERENCES expense_categories(id),
  description     TEXT,
  amount          NUMERIC(15,2) NOT NULL,
  paid_via        VARCHAR(30),  -- Cash, Bank-HDFC, etc.
  payment_account_id INTEGER REFERENCES accounts(id),
  reference_no    VARCHAR(50),
  department_id   INTEGER REFERENCES departments(id),
  je_id           INTEGER REFERENCES journal_entries(id),
  status          VARCHAR(20) DEFAULT 'PENDING',  -- PENDING, PAID
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE SEQUENCE exp_seq START 100;

-- ============================================================
-- PROCESS TRACKING (Send / Return)
-- ============================================================
CREATE TYPE process_trs_type AS ENUM ('send', 'return');

CREATE TABLE process_transactions (
  id              SERIAL PRIMARY KEY,
  trs_number      VARCHAR(20) UNIQUE NOT NULL,
  trs_type        process_trs_type NOT NULL,
  trs_date        DATE NOT NULL,
  process_name    VARCHAR(50) NOT NULL,    -- CVD Growing, Laser Cutting, etc.
  machine_id      INTEGER REFERENCES machines(id),
  department_id   INTEGER REFERENCES departments(id),
  worker_name     VARCHAR(100),
  expected_return DATE,
  priority        VARCHAR(20) DEFAULT 'Normal',
  remark          TEXT,
  -- Return-specific fields
  send_ref_id     INTEGER REFERENCES process_transactions(id),  -- links return to its send
  return_status   VARCHAR(30),  -- Completed, Partial, Failed
  -- Totals
  total_qty_in    NUMERIC(12,2) DEFAULT 0,
  total_wt_in     NUMERIC(12,4) DEFAULT 0,
  total_qty_out   NUMERIC(12,2) DEFAULT 0,
  total_wt_out    NUMERIC(12,4) DEFAULT 0,
  -- Parameters (JSON for flexibility per process type)
  parameters      JSONB DEFAULT '{}',
  je_id           INTEGER REFERENCES journal_entries(id),
  status          VARCHAR(20) DEFAULT 'OPEN',  -- OPEN, COMPLETED, CANCELLED
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE SEQUENCE ps_seq START 1100;
CREATE SEQUENCE pr_seq START 1100;

CREATE TABLE process_transaction_lines (
  id              SERIAL PRIMARY KEY,
  process_trs_id  INTEGER NOT NULL REFERENCES process_transactions(id) ON DELETE CASCADE,
  inventory_id    INTEGER REFERENCES inventory(id),
  lot_number      VARCHAR(30),
  lot_name        VARCHAR(100),
  item_type       VARCHAR(30),
  qty_in          NUMERIC(12,2) DEFAULT 0,
  wt_in           NUMERIC(12,4) DEFAULT 0,
  qty_out         NUMERIC(12,2) DEFAULT 0,
  wt_out          NUMERIC(12,4) DEFAULT 0,
  yield_pct       NUMERIC(8,2) DEFAULT 0,
  next_process    VARCHAR(50),
  remark          TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ptl_trs ON process_transaction_lines(process_trs_id);

-- ============================================================
-- ROUGH DIAMOND GROWTH (Yield Entry)
-- ============================================================
CREATE TABLE rough_growth (
  id              SERIAL PRIMARY KEY,
  growth_number   VARCHAR(20) UNIQUE NOT NULL,
  growth_date     DATE NOT NULL,
  cycle_no        INTEGER DEFAULT 1,
  machine_id      INTEGER REFERENCES machines(id),
  seed_inventory_id INTEGER REFERENCES inventory(id),   -- the seed used (IN PROCESS)
  department_id   INTEGER REFERENCES departments(id),
  remark          TEXT,
  -- Totals
  total_lots      INTEGER DEFAULT 0,
  total_weight    NUMERIC(12,4) DEFAULT 0,
  -- Cost breakdown (auto-calc with override)
  cost_seed       NUMERIC(12,2) DEFAULT 0,
  cost_gas        NUMERIC(12,2) DEFAULT 0,
  cost_power      NUMERIC(12,2) DEFAULT 0,
  cost_labour     NUMERIC(12,2) DEFAULT 0,
  cost_consumable NUMERIC(12,2) DEFAULT 0,
  cost_maintenance NUMERIC(12,2) DEFAULT 0,
  total_cost      NUMERIC(15,2) DEFAULT 0,
  cost_per_carat  NUMERIC(12,2) DEFAULT 0,
  je_id           INTEGER REFERENCES journal_entries(id),
  status          VARCHAR(20) DEFAULT 'COMPLETED',
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE SEQUENCE gr_seq START 100;

CREATE TABLE rough_growth_lines (
  id              SERIAL PRIMARY KEY,
  growth_id       INTEGER NOT NULL REFERENCES rough_growth(id) ON DELETE CASCADE,
  line_no         INTEGER DEFAULT 1,
  lot_number      VARCHAR(30) UNIQUE NOT NULL,   -- RD-XXXX (auto-generated)
  weight          NUMERIC(12,4) NOT NULL,
  size_ref        VARCHAR(20),
  shape           VARCHAR(30) DEFAULT 'Rough',
  color_est       VARCHAR(20) DEFAULT 'D-E',
  clarity_est     VARCHAR(20) DEFAULT 'VS Est.',
  remark          TEXT,
  inventory_id    INTEGER REFERENCES inventory(id),  -- links to created rough inventory record
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE SEQUENCE rd_seq START 5030;

CREATE INDEX idx_rgl_growth ON rough_growth_lines(growth_id);

-- ============================================================
-- TRIGGERS for Phase 2 tables
-- ============================================================
CREATE TRIGGER trg_inventory_updated BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_pn_updated BEFORE UPDATE ON purchase_notes FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_expenses_updated BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_ptrs_updated BEFORE UPDATE ON process_transactions FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_rg_updated BEFORE UPDATE ON rough_growth FOR EACH ROW EXECUTE FUNCTION update_timestamp();
