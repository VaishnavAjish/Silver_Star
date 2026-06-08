-- Bank Reconciliation Tables
-- Run once against the database: psql -d <db> -f bank_recon_migration.sql

CREATE TABLE IF NOT EXISTS bank_reconciliation (
  id               SERIAL       PRIMARY KEY,
  account_id       INTEGER      NOT NULL REFERENCES accounts(id),
  statement_date   DATE         NOT NULL,
  statement_balance NUMERIC(14,2) DEFAULT 0,
  created_by       INTEGER      REFERENCES users(id),
  created_at       TIMESTAMP    DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_reconciliation_lines (
  id                  SERIAL       PRIMARY KEY,
  reconciliation_id   INTEGER      NOT NULL REFERENCES bank_reconciliation(id) ON DELETE CASCADE,
  je_id               INTEGER      REFERENCES journal_entries(id),
  system_amount       NUMERIC(14,2) DEFAULT 0,
  bank_amount         NUMERIC(14,2) DEFAULT 0,
  match_status        VARCHAR(20)  DEFAULT 'unmatched',  -- matched / unmatched / manual
  bank_date           DATE,
  bank_ref            TEXT
);

CREATE INDEX IF NOT EXISTS idx_bank_recon_account  ON bank_reconciliation(account_id);
CREATE INDEX IF NOT EXISTS idx_bank_recon_lines_recon ON bank_reconciliation_lines(reconciliation_id);
CREATE INDEX IF NOT EXISTS idx_bank_recon_lines_je ON bank_reconciliation_lines(je_id);
