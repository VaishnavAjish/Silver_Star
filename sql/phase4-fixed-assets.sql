-- ============================================================
-- SILVERSTAR GROW — Phase 4: Fixed Assets Module
-- Run AFTER phase3-schema.sql
-- ============================================================

-- ============================================================
-- FIXED ASSET CATEGORIES
-- ============================================================
CREATE TABLE fixed_asset_categories (
  id                          SERIAL PRIMARY KEY,
  code                        VARCHAR(20) UNIQUE NOT NULL,
  name                        VARCHAR(100) NOT NULL,
  depreciation_rate_pct       NUMERIC(5,2) NOT NULL CHECK (depreciation_rate_pct >= 0 AND depreciation_rate_pct <= 100),
  depreciation_method         VARCHAR(10) NOT NULL DEFAULT 'SLM' CHECK (depreciation_method IN ('SLM','WDV')),
  useful_life_years           INTEGER,
  gl_asset_account_id         INTEGER NOT NULL REFERENCES accounts(id),
  gl_accum_depr_account_id    INTEGER NOT NULL REFERENCES accounts(id),
  gl_depr_expense_account_id  INTEGER NOT NULL REFERENCES accounts(id),
  status                      master_status DEFAULT 'active',
  created_at                  TIMESTAMPTZ DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_fac_updated
  BEFORE UPDATE ON fixed_asset_categories
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ============================================================
-- FIXED ASSETS
-- ============================================================
CREATE TYPE fixed_asset_status AS ENUM ('active','disposed','written_off');
CREATE SEQUENCE fa_seq START 1;

CREATE TABLE fixed_assets (
  id                        SERIAL PRIMARY KEY,
  asset_code                VARCHAR(30) UNIQUE NOT NULL,
  asset_name                VARCHAR(150) NOT NULL,
  category_id               INTEGER NOT NULL REFERENCES fixed_asset_categories(id),
  purchase_note_id          INTEGER REFERENCES purchase_notes(id) ON DELETE SET NULL,
  purchase_note_line_id     INTEGER REFERENCES purchase_note_lines(id) ON DELETE SET NULL,
  vendor_id                 INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  location_id               INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  department_id             INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  purchase_date             DATE NOT NULL,
  in_service_date           DATE NOT NULL,
  invoice_no                VARCHAR(50),
  invoice_date              DATE,
  taxable_value             NUMERIC(15,2) DEFAULT 0 CHECK (taxable_value >= 0),
  gst_rate                  NUMERIC(5,2) DEFAULT 0 CHECK (gst_rate >= 0),
  cgst_amount               NUMERIC(15,2) DEFAULT 0 CHECK (cgst_amount >= 0),
  sgst_amount               NUMERIC(15,2) DEFAULT 0 CHECK (sgst_amount >= 0),
  igst_amount               NUMERIC(15,2) DEFAULT 0 CHECK (igst_amount >= 0),
  gst_claimable_amount      NUMERIC(15,2) DEFAULT 0 CHECK (gst_claimable_amount >= 0),
  gst_non_claimable_amount  NUMERIC(15,2) DEFAULT 0 CHECK (gst_non_claimable_amount >= 0),
  gst_treatment             VARCHAR(20) DEFAULT 'non_claimable'
    CHECK (gst_treatment IN ('claimable','non_claimable','partial')),
  total_invoice_value       NUMERIC(15,2) DEFAULT 0 CHECK (total_invoice_value >= 0),
  purchase_cost             NUMERIC(15,2) NOT NULL CHECK (purchase_cost >= 0),
  salvage_value             NUMERIC(15,2) DEFAULT 0 CHECK (salvage_value >= 0),
  accumulated_depreciation  NUMERIC(15,2) NOT NULL DEFAULT 0,
  status                    fixed_asset_status NOT NULL DEFAULT 'active',
  disposal_date             DATE,
  disposal_value            NUMERIC(15,2),
  remarks                   TEXT,
  created_by                INTEGER REFERENCES users(id),
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT salvage_lte_cost CHECK (salvage_value <= purchase_cost)
);

CREATE INDEX idx_fa_category    ON fixed_assets(category_id);
CREATE INDEX idx_fa_status      ON fixed_assets(status);
CREATE INDEX idx_fa_purchase_date ON fixed_assets(purchase_date);

CREATE TRIGGER trg_fa_updated
  BEFORE UPDATE ON fixed_assets
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE fixed_asset_gst_ledger (
  id                         SERIAL PRIMARY KEY,
  fixed_asset_id             INTEGER NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
  vendor_id                  INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  invoice_no                 VARCHAR(50),
  invoice_date               DATE,
  taxable_value              NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (taxable_value >= 0),
  cgst_amount                NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (cgst_amount >= 0),
  sgst_amount                NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (sgst_amount >= 0),
  igst_amount                NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (igst_amount >= 0),
  gst_claimable_amount       NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (gst_claimable_amount >= 0),
  gst_non_claimable_amount   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (gst_non_claimable_amount >= 0),
  total_invoice_value        NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_invoice_value >= 0),
  treatment                  VARCHAR(20) NOT NULL DEFAULT 'non_claimable'
    CHECK (treatment IN ('claimable','non_claimable','partial')),
  remarks                    TEXT,
  created_at                 TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_fa_gst_asset ON fixed_asset_gst_ledger(fixed_asset_id);
CREATE INDEX idx_fa_gst_invoice_date ON fixed_asset_gst_ledger(invoice_date);

-- ============================================================
-- DEPRECIATION RUNS
-- ============================================================
CREATE SEQUENCE dr_seq START 1;

CREATE TABLE depreciation_runs (
  id            SERIAL PRIMARY KEY,
  run_number    VARCHAR(20) UNIQUE NOT NULL,
  period_from   DATE NOT NULL,
  period_to     DATE NOT NULL,
  je_id         INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL,
  total_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
  status        VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  remarks       TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT period_valid CHECK (period_to >= period_from)
);

CREATE TABLE depreciation_run_lines (
  id                    SERIAL PRIMARY KEY,
  run_id                INTEGER NOT NULL REFERENCES depreciation_runs(id) ON DELETE CASCADE,
  fixed_asset_id        INTEGER NOT NULL REFERENCES fixed_assets(id),
  opening_wdv           NUMERIC(15,2) NOT NULL,
  depreciation_amount   NUMERIC(15,2) NOT NULL CHECK (depreciation_amount >= 0),
  closing_wdv           NUMERIC(15,2) NOT NULL,
  days_in_period        INTEGER NOT NULL,
  UNIQUE (run_id, fixed_asset_id)
);

CREATE INDEX idx_dep_run_lines_asset ON depreciation_run_lines(fixed_asset_id);

-- ============================================================
-- EXTEND EXISTING TABLES
-- ============================================================
ALTER TABLE items
  ADD COLUMN is_capital_asset       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN fixed_asset_category_id INTEGER REFERENCES fixed_asset_categories(id);

ALTER TABLE purchase_note_lines
  ADD COLUMN is_capital BOOLEAN NOT NULL DEFAULT FALSE;

-- ============================================================
-- WDV VIEW
-- ============================================================
CREATE OR REPLACE VIEW v_fixed_asset_wdv AS
SELECT
  fa.id,
  fa.asset_code,
  fa.asset_name,
  fa.category_id,
  fac.name                                        AS category_name,
  fac.depreciation_rate_pct,
  fac.depreciation_method,
  fa.purchase_cost,
  fa.salvage_value,
  fa.accumulated_depreciation,
  (fa.purchase_cost - fa.accumulated_depreciation) AS wdv_today,
  fa.status,
  fa.in_service_date
FROM fixed_assets fa
JOIN fixed_asset_categories fac ON fa.category_id = fac.id;

-- ============================================================
-- SEED CHART OF ACCOUNTS (INSERT ONLY IF MISSING)
-- ============================================================
INSERT INTO accounts (code, name, type, parent_id, description)
SELECT '2007','Plant & Machinery','asset',
       (SELECT id FROM accounts WHERE code='2000'),
       'Plant and machinery assets'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code='2007');

INSERT INTO accounts (code, name, type, parent_id, description)
SELECT '2008','Office Equipment','asset',
       (SELECT id FROM accounts WHERE code='2000'),
       'Office equipment assets'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code='2008');

INSERT INTO accounts (code, name, type, parent_id, description)
SELECT '2009','Furniture & Fixtures','asset',
       (SELECT id FROM accounts WHERE code='2000'),
       'Furniture and fixtures'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code='2009');

INSERT INTO accounts (code, name, type, parent_id, description)
SELECT '2010','Computers & IT Equipment','asset',
       (SELECT id FROM accounts WHERE code='2000'),
       'Computers and IT equipment'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code='2010');

INSERT INTO accounts (code, name, type, parent_id, description)
SELECT '2099','Accumulated Depreciation','asset',
       (SELECT id FROM accounts WHERE code='2000'),
       'Accumulated depreciation — contra asset (credit balance)'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code='2099');

INSERT INTO accounts (code, name, type, parent_id, description)
SELECT '5009','Depreciation Expense','expense',
       (SELECT id FROM accounts WHERE code='5000'),
       'Periodic depreciation charge on fixed assets'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code='5009');

INSERT INTO accounts (code, name, type, parent_id, description)
SELECT '4099','Gain on Asset Disposal','revenue',
       (SELECT id FROM accounts WHERE code='4000'),
       'Gain recognised on disposal of fixed assets'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code='4099');

INSERT INTO accounts (code, name, type, parent_id, description)
SELECT '5010','Loss on Asset Disposal','expense',
       (SELECT id FROM accounts WHERE code='5000'),
       'Loss recognised on disposal of fixed assets'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code='5010');

-- ============================================================
-- SEED STARTER ASSET CATEGORIES
-- ============================================================
INSERT INTO fixed_asset_categories
  (code, name, depreciation_rate_pct, depreciation_method, useful_life_years,
   gl_asset_account_id, gl_accum_depr_account_id, gl_depr_expense_account_id)
SELECT 'FAC-PLANT','Plant & Machinery',15.00,'SLM',7,
  (SELECT id FROM accounts WHERE code='2007'),
  (SELECT id FROM accounts WHERE code='2099'),
  (SELECT id FROM accounts WHERE code='5009')
WHERE NOT EXISTS (SELECT 1 FROM fixed_asset_categories WHERE code='FAC-PLANT');

INSERT INTO fixed_asset_categories
  (code, name, depreciation_rate_pct, depreciation_method, useful_life_years,
   gl_asset_account_id, gl_accum_depr_account_id, gl_depr_expense_account_id)
SELECT 'FAC-COMP','Computers & IT',40.00,'SLM',3,
  (SELECT id FROM accounts WHERE code='2010'),
  (SELECT id FROM accounts WHERE code='2099'),
  (SELECT id FROM accounts WHERE code='5009')
WHERE NOT EXISTS (SELECT 1 FROM fixed_asset_categories WHERE code='FAC-COMP');

INSERT INTO fixed_asset_categories
  (code, name, depreciation_rate_pct, depreciation_method, useful_life_years,
   gl_asset_account_id, gl_accum_depr_account_id, gl_depr_expense_account_id)
SELECT 'FAC-FURN','Furniture & Fixtures',10.00,'SLM',10,
  (SELECT id FROM accounts WHERE code='2009'),
  (SELECT id FROM accounts WHERE code='2099'),
  (SELECT id FROM accounts WHERE code='5009')
WHERE NOT EXISTS (SELECT 1 FROM fixed_asset_categories WHERE code='FAC-FURN');
