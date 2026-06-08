-- ============================================================
-- SILVERSTAR GROW — Phase 24: Process Lifecycle Engine
-- Adds lot-level process issue/return tracking and op history.
-- ============================================================

-- Sequences for tracking numbers
CREATE SEQUENCE lot_issue_seq START 1;
CREATE SEQUENCE lot_return_seq START 1;

-- Process Issue: records qty extracted from a lot and sent to process
CREATE TABLE lot_process_issues (
  id              SERIAL PRIMARY KEY,
  issue_number    VARCHAR(20) UNIQUE NOT NULL,
  source_lot_id   INTEGER NOT NULL REFERENCES inventory(id),
  process_lot_id  INTEGER REFERENCES inventory(id),
  issued_qty      NUMERIC(15,4) NOT NULL CHECK (issued_qty > 0),
  issue_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  expected_return DATE,
  department      VARCHAR(100),
  operator        VARCHAR(100),
  remarks         TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'OPEN',  -- OPEN | RETURNED
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Process Return: outcome of an IN_PROCESS lot
CREATE TABLE lot_process_returns (
  id            SERIAL PRIMARY KEY,
  return_number VARCHAR(20) UNIQUE NOT NULL,
  issue_id      INTEGER NOT NULL UNIQUE REFERENCES lot_process_issues(id),
  return_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  usable_qty    NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (usable_qty >= 0),
  damaged_qty   NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (damaged_qty >= 0),
  consumed_qty  NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (consumed_qty >= 0),
  remarks       TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Lot Operation Log: full audit trail of every qty mutation on a lot
CREATE TABLE lot_op_log (
  id             SERIAL PRIMARY KEY,
  lot_id         INTEGER NOT NULL REFERENCES inventory(id),
  operation      VARCHAR(30) NOT NULL,
  reference_type VARCHAR(30),
  reference_id   INTEGER,
  qty_delta      NUMERIC(15,4),
  new_status     VARCHAR(20),
  notes          TEXT,
  performed_by   INTEGER REFERENCES users(id),
  performed_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_lpi_source     ON lot_process_issues(source_lot_id);
CREATE INDEX idx_lpi_process    ON lot_process_issues(process_lot_id);
CREATE INDEX idx_lpi_status     ON lot_process_issues(status);
CREATE INDEX idx_lpr_issue      ON lot_process_returns(issue_id);
CREATE INDEX idx_lot_op_lot     ON lot_op_log(lot_id);
CREATE INDEX idx_lot_op_ref     ON lot_op_log(reference_type, reference_id);
