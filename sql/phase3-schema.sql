-- ============================================================
-- SILVERSTAR GROW — Phase 3 Schema
-- Run AFTER phase2-schema.sql
-- ============================================================

-- ============================================================
-- CUSTOMERS (for rough diamond sales)
-- ============================================================
CREATE TABLE customers (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(20) UNIQUE NOT NULL,
  name            VARCHAR(150) NOT NULL,
  contact_person  VARCHAR(100),
  phone           VARCHAR(20),
  email           VARCHAR(150),
  address         TEXT,
  city            VARCHAR(50),
  state           VARCHAR(50),
  gstin           VARCHAR(22),
  pan             VARCHAR(12),
  payment_term    VARCHAR(30) DEFAULT '30 Days',
  credit_limit    NUMERIC(15,2) DEFAULT 0,
  outstanding     NUMERIC(15,2) DEFAULT 0,
  status          master_status DEFAULT 'active',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================================
-- ROUGH INVOICES (Sales)
-- ============================================================
CREATE TABLE invoices (
  id              SERIAL PRIMARY KEY,
  doc_number      VARCHAR(20) UNIQUE NOT NULL,
  doc_date        DATE NOT NULL,
  invoice_type    VARCHAR(20) DEFAULT 'sale',  -- sale, return
  customer_id     INTEGER REFERENCES customers(id),
  payment_term    VARCHAR(30) DEFAULT '30 Days',
  currency        VARCHAR(3) DEFAULT 'INR',
  reference_no    VARCHAR(50),
  remark          TEXT,
  -- Totals
  total_qty       NUMERIC(12,2) DEFAULT 0,
  total_weight    NUMERIC(12,4) DEFAULT 0,
  sub_total       NUMERIC(15,2) DEFAULT 0,
  tax_pct         NUMERIC(5,2) DEFAULT 5,
  tax_amount      NUMERIC(12,2) DEFAULT 0,
  grand_total     NUMERIC(15,2) DEFAULT 0,
  amount_paid     NUMERIC(15,2) DEFAULT 0,
  balance_due     NUMERIC(15,2) DEFAULT 0,
  -- Accounting
  je_id           INTEGER REFERENCES journal_entries(id),
  cogs_je_id      INTEGER REFERENCES journal_entries(id),
  status          doc_status DEFAULT 'open',
  payment_status  VARCHAR(20) DEFAULT 'UNPAID',  -- UNPAID, PARTIAL, PAID
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE SEQUENCE inv_seq START 3001;

CREATE TABLE invoice_lines (
  id              SERIAL PRIMARY KEY,
  invoice_id      INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_no         INTEGER DEFAULT 1,
  inventory_id    INTEGER REFERENCES inventory(id),
  lot_number      VARCHAR(30),
  lot_name        VARCHAR(100),
  qty             NUMERIC(12,2) DEFAULT 1,
  weight          NUMERIC(12,4) DEFAULT 0,
  color           VARCHAR(20),
  clarity         VARCHAR(20),
  rate_per_carat  NUMERIC(12,2) DEFAULT 0,
  amount          NUMERIC(15,2) DEFAULT 0,
  cost_value      NUMERIC(15,2) DEFAULT 0,  -- for COGS booking
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invl_invoice ON invoice_lines(invoice_id);

-- ============================================================
-- PAYMENTS (to vendors)
-- ============================================================
CREATE TABLE payments (
  id              SERIAL PRIMARY KEY,
  doc_number      VARCHAR(20) UNIQUE NOT NULL,
  date            DATE NOT NULL,
  vendor_id       INTEGER REFERENCES vendors(id),
  amount          NUMERIC(15,2) NOT NULL,
  payment_mode    VARCHAR(30) DEFAULT 'Bank Transfer',  -- Cash, Bank Transfer, RTGS, NEFT, UPI, Cheque
  bank_account_id INTEGER REFERENCES accounts(id),
  reference_no    VARCHAR(50),
  cheque_no       VARCHAR(30),
  cheque_date     DATE,
  remark          TEXT,
  purchase_note_id INTEGER REFERENCES purchase_notes(id),  -- optional link
  je_id           INTEGER REFERENCES journal_entries(id),
  status          VARCHAR(20) DEFAULT 'COMPLETED',
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE SEQUENCE pay_seq START 500;

-- ============================================================
-- RECEIPTS (from customers)
-- ============================================================
CREATE TABLE receipts (
  id              SERIAL PRIMARY KEY,
  doc_number      VARCHAR(20) UNIQUE NOT NULL,
  date            DATE NOT NULL,
  customer_id     INTEGER REFERENCES customers(id),
  amount          NUMERIC(15,2) NOT NULL,
  payment_mode    VARCHAR(30) DEFAULT 'Bank Transfer',
  bank_account_id INTEGER REFERENCES accounts(id),
  reference_no    VARCHAR(50),
  cheque_no       VARCHAR(30),
  cheque_date     DATE,
  remark          TEXT,
  invoice_id      INTEGER REFERENCES invoices(id),  -- optional link
  je_id           INTEGER REFERENCES journal_entries(id),
  status          VARCHAR(20) DEFAULT 'COMPLETED',
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE SEQUENCE rct_seq START 500;

-- ============================================================
-- SEED CUSTOMERS
-- ============================================================
INSERT INTO customers (code, name, contact_person, phone, city, state, gstin, payment_term) VALUES
('CUS-001', 'Nidhi Impex', 'Dharmesh Shah', '+91 98250 12345', 'Surat', 'Gujarat', '24AABCN1234F1Z5', '30 Days'),
('CUS-002', 'Diamond World Trading', 'Vikram Mehta', '+91 90123 45678', 'Mumbai', 'Maharashtra', '27BCDEW5678G2Z3', '15 Days'),
('CUS-003', 'Gem Traders International', 'Anil Kumar', '+91 87654 32100', 'Jaipur', 'Rajasthan', '08EFGHT9012H3Z1', '30 Days'),
('CUS-004', 'Skylab Diamond Inc', 'John Davis', '+1 212 555 0199', 'New York', 'NY, USA', NULL, '60 Days'),
('CUS-005', 'HK Gems Ltd', 'David Wong', '+852 2345 6789', 'Hong Kong', 'HK', NULL, '45 Days');

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_receipts_updated BEFORE UPDATE ON receipts FOR EACH ROW EXECUTE FUNCTION update_timestamp();
