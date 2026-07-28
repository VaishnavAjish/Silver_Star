-- Phase 76: NidhiConnect Controlled Lot Name Correction Schema

CREATE TABLE IF NOT EXISTS lot_series (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL DEFAULT 1,
  series_prefix VARCHAR(50) NOT NULL,
  next_number INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_lot_series_prefix UNIQUE (company_id, series_prefix)
);

CREATE TABLE IF NOT EXISTS import_batches (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL DEFAULT 1,
  batch_number VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_row_lots (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL DEFAULT 1,
  batch_id INT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  lot_series_id INT NOT NULL REFERENCES lot_series(id),
  lot_name VARCHAR(100) NOT NULL,
  sequence_number VARCHAR(20) NOT NULL,
  row_version INT NOT NULL DEFAULT 1,
  b5_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  b5_reconciliation_status VARCHAR(30) DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_import_row_lot_name UNIQUE (company_id, lot_name),
  CONSTRAINT uq_import_row_lot_series_seq UNIQUE (lot_series_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS import_row_lot_events (
  id SERIAL PRIMARY KEY,
  import_row_lot_id INT NOT NULL REFERENCES import_row_lots(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  old_lot_name VARCHAR(100) NOT NULL,
  new_lot_name VARCHAR(100) NOT NULL,
  old_lot_series_id INT,
  new_lot_series_id INT,
  reason TEXT NOT NULL,
  actor_id INT NOT NULL,
  request_id VARCHAR(100),
  row_version INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_batch_snapshots (
  id SERIAL PRIMARY KEY,
  batch_id INT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  snapshot_type VARCHAR(30) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
