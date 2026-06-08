-- ============================================================
-- SILVERSTAR GROW — Phase 1 Database Schema
-- PostgreSQL 15+
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- AUTH & USERS
-- ============================================================
CREATE TYPE user_role AS ENUM ('admin', 'operator', 'viewer');

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50) UNIQUE NOT NULL,
  email         VARCHAR(150) UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(100) NOT NULL,
  role          user_role NOT NULL DEFAULT 'operator',
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  is_active     BOOLEAN DEFAULT TRUE,
  last_login    TIMESTAMPTZ,
  mfa_secret    VARCHAR(64),
  mfa_enabled   BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ACCOUNTING CORE
-- ============================================================
CREATE TYPE account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE account_status AS ENUM ('active', 'inactive');

CREATE TABLE accounts (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(20) UNIQUE NOT NULL,
  name        VARCHAR(150) NOT NULL,
  type        account_type NOT NULL,
  parent_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  is_group    BOOLEAN DEFAULT FALSE,
  currency    VARCHAR(3) DEFAULT 'INR',
  balance     NUMERIC(15,2) DEFAULT 0.00,
  status      account_status DEFAULT 'active',
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_accounts_type ON accounts(type);
CREATE INDEX idx_accounts_parent ON accounts(parent_id);

CREATE TYPE je_status AS ENUM ('draft', 'posted', 'cancelled');

CREATE TABLE journal_entries (
  id            SERIAL PRIMARY KEY,
  je_number     VARCHAR(20) UNIQUE NOT NULL,
  date          DATE NOT NULL,
  description   TEXT,
  source_type   VARCHAR(30),  -- purchase, expense, growth, invoice, payment, receipt, manual
  source_id     INTEGER,
  total_debit   NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_credit  NUMERIC(15,2) NOT NULL DEFAULT 0,
  status        je_status DEFAULT 'draft',
  posted_at     TIMESTAMPTZ,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  -- THE SAFETY NET: Database refuses unbalanced entries
  CONSTRAINT je_balanced CHECK (total_debit = total_credit)
);

CREATE INDEX idx_je_date ON journal_entries(date);
CREATE INDEX idx_je_source ON journal_entries(source_type, source_id);
CREATE INDEX idx_je_status ON journal_entries(status);

CREATE TABLE je_lines (
  id          SERIAL PRIMARY KEY,
  je_id       INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  debit       NUMERIC(15,2) DEFAULT 0.00,
  credit      NUMERIC(15,2) DEFAULT 0.00,
  narration   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  -- Each line must be either debit or credit, not both
  CONSTRAINT je_line_single_side CHECK (
    (debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0)
  )
);

CREATE INDEX idx_je_lines_je ON je_lines(je_id);
CREATE INDEX idx_je_lines_account ON je_lines(account_id);

-- ============================================================
-- MASTER TABLES
-- ============================================================
CREATE TYPE item_category AS ENUM ('seed', 'gas', 'consumable', 'rough');
CREATE TYPE item_type AS ENUM ('raw_material', 'finished_good');
CREATE TYPE master_status AS ENUM ('active', 'inactive');

CREATE TABLE items (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(30) UNIQUE NOT NULL,
  name          VARCHAR(150) NOT NULL,
  category      item_category NOT NULL,
  type          item_type NOT NULL DEFAULT 'raw_material',
  default_uom   VARCHAR(10) DEFAULT 'Pcs',
  hsn_code      VARCHAR(20),
  reorder_level INTEGER DEFAULT 0,
  description   TEXT,
  status        master_status DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_items_category ON items(category);

CREATE TYPE vendor_category AS ENUM ('seed', 'gas', 'consumable', 'general');

CREATE TABLE vendors (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(20) UNIQUE NOT NULL,
  name            VARCHAR(150) NOT NULL,
  category        vendor_category DEFAULT 'general',
  contact_person  VARCHAR(100),
  phone           VARCHAR(20),
  email           VARCHAR(150),
  address         TEXT,
  city            VARCHAR(50),
  state           VARCHAR(50),
  gstin           VARCHAR(22),
  pan             VARCHAR(12),
  payment_term    VARCHAR(30) DEFAULT 'Immediate',
  bank_details    TEXT,
  status          master_status DEFAULT 'active',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE departments (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(20) UNIQUE NOT NULL,
  name        VARCHAR(100) NOT NULL,
  head        VARCHAR(100),
  location_id INTEGER,
  staff_count INTEGER DEFAULT 0,
  status      master_status DEFAULT 'active',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE locations (
  id        SERIAL PRIMARY KEY,
  code      VARCHAR(20) UNIQUE NOT NULL,
  name      VARCHAR(100) NOT NULL,
  type      VARCHAR(30) DEFAULT 'factory',  -- factory, office, warehouse
  address   TEXT,
  city      VARCHAR(50),
  state     VARCHAR(50),
  manager   VARCHAR(100),
  status    master_status DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE departments ADD CONSTRAINT fk_dept_location 
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;

CREATE TYPE machine_status AS ENUM ('running', 'maintenance', 'idle');

CREATE TABLE machines (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(20) UNIQUE NOT NULL,
  name            VARCHAR(100) NOT NULL,
  type            VARCHAR(50),
  department_id   INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  location_id     INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  capacity        VARCHAR(50),
  last_service    DATE,
  next_service    DATE,
  status          machine_status DEFAULT 'running',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE uom (
  id      SERIAL PRIMARY KEY,
  code    VARCHAR(10) UNIQUE NOT NULL,
  name    VARCHAR(50) NOT NULL,
  symbol  VARCHAR(10),
  type    VARCHAR(20) DEFAULT 'count',  -- count, weight, volume, time
  status  master_status DEFAULT 'active'
);

CREATE TABLE expense_categories (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(20) UNIQUE NOT NULL,
  name          VARCHAR(100) NOT NULL,
  gl_account_id INTEGER REFERENCES accounts(id),
  monthly_budget NUMERIC(12,2) DEFAULT 0,
  status        master_status DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- AUTO-NUMBER SEQUENCE FOR JE
-- ============================================================
CREATE SEQUENCE je_seq START 4001;

-- ============================================================
-- FUNCTION: Auto-update updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_accounts_updated BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_je_updated BEFORE UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_items_updated BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_vendors_updated BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_departments_updated BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_locations_updated BEFORE UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_machines_updated BEFORE UPDATE ON machines FOR EACH ROW EXECUTE FUNCTION update_timestamp();
