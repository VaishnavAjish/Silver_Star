CREATE TYPE account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE account_status AS ENUM ('active', 'inactive');
CREATE TYPE je_status AS ENUM ('draft', 'posted', 'cancelled');

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
CREATE INDEX idx_accounts_type   ON accounts(type);
CREATE INDEX idx_accounts_parent ON accounts(parent_id);
CREATE TRIGGER trg_accounts_updated BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE SEQUENCE je_seq START 4001;

CREATE TABLE journal_entries (
  id            SERIAL PRIMARY KEY,
  je_number     VARCHAR(20) UNIQUE NOT NULL,
  date          DATE NOT NULL,
  description   TEXT,
  source_type   VARCHAR(30),
  source_id     INTEGER,
  total_debit   NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_credit  NUMERIC(15,2) NOT NULL DEFAULT 0,
  status        je_status DEFAULT 'draft',
  posted_at     TIMESTAMPTZ,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT je_balanced CHECK (total_debit = total_credit)
);
CREATE INDEX idx_je_date   ON journal_entries(date);
CREATE INDEX idx_je_source ON journal_entries(source_type, source_id);
CREATE INDEX idx_je_status ON journal_entries(status);
CREATE TRIGGER trg_je_updated BEFORE UPDATE ON journal_entries FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TABLE je_lines (
  id          SERIAL PRIMARY KEY,
  je_id       INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  debit       NUMERIC(15,2) DEFAULT 0.00,
  credit      NUMERIC(15,2) DEFAULT 0.00,
  narration   TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT je_line_single_side CHECK (
    (debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0)
  )
);
CREATE INDEX idx_je_lines_je      ON je_lines(je_id);
CREATE INDEX idx_je_lines_account ON je_lines(account_id);
