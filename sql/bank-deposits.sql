-- ============================================================
-- Bank Deposits Module
-- ============================================================

-- Bank Deposits Header
CREATE TABLE bank_deposits (
  id            SERIAL PRIMARY KEY,
  date          DATE NOT NULL,
  bank_account_id INTEGER NOT NULL REFERENCES accounts(id),
  total_amount  NUMERIC(15,2) NOT NULL CHECK (total_amount > 0),
  memo          TEXT,
  je_id         INTEGER REFERENCES journal_entries(id),
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Bank Deposit Lines
CREATE TABLE bank_deposit_lines (
  id            SERIAL PRIMARY KEY,
  deposit_id    INTEGER NOT NULL REFERENCES bank_deposits(id) ON DELETE CASCADE,
  party_name    VARCHAR(150), -- Optional party name
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  description   TEXT,
  amount        NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  payment_method VARCHAR(50), -- Cash, Cheque, Bank Transfer, etc.
  ref_no        VARCHAR(100), -- Reference number
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_bank_deposits_date ON bank_deposits(date);
CREATE INDEX idx_bank_deposits_bank_account ON bank_deposits(bank_account_id);
CREATE INDEX idx_bank_deposits_je ON bank_deposits(je_id);
CREATE INDEX idx_bank_deposit_lines_deposit ON bank_deposit_lines(deposit_id);
CREATE INDEX idx_bank_deposit_lines_account ON bank_deposit_lines(account_id);

-- Sequence for deposit numbering (if needed for future)
-- CREATE SEQUENCE deposit_seq START 1;