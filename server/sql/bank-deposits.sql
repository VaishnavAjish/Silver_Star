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

-- ============================================================
-- Sample bank deposit seed data
-- ============================================================
WITH dep AS (
  INSERT INTO bank_deposits (date, bank_account_id, total_amount, memo, created_by)
  VALUES (
    CURRENT_DATE,
    (SELECT id FROM accounts WHERE code = '1002'),   -- Bank - HDFC
    125000.00,
    'Sample bank deposit for customer collections',
    (SELECT id FROM users WHERE username = 'admin')
  )
  RETURNING id
)
INSERT INTO bank_deposit_lines (deposit_id, party_name, account_id, description, amount, payment_method, ref_no)
SELECT
  dep.id,
  'Customer A',
  (SELECT id FROM accounts WHERE code = '1003'),   -- Accounts Receivable
  'Customer payment received',
  50000.00,
  'Cheque',
  'CHQ-1001'
FROM dep
UNION ALL
SELECT
  dep.id,
  'Customer B',
  (SELECT id FROM accounts WHERE code = '1003'),
  'Second customer payment received',
  75000.00,
  'Bank Transfer',
  'TRF-2002'
FROM dep;