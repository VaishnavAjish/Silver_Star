-- ==============================================================================
-- Phase 4.8: Internal Funds Transfer Engine
-- Creates the transfers table and adds the sequence config for transfer documents
-- ==============================================================================

BEGIN;

-- 1. Create Transfers Table
CREATE TABLE IF NOT EXISTS transfers (
  id SERIAL PRIMARY KEY,
  transfer_no VARCHAR(50) UNIQUE NOT NULL,
  transfer_date DATE NOT NULL,
  from_account_id INTEGER NOT NULL REFERENCES accounts(id),
  to_account_id INTEGER NOT NULL REFERENCES accounts(id),
  amount NUMERIC(15,2) NOT NULL,
  reference_no VARCHAR(100),
  memo TEXT,
  department_id INTEGER REFERENCES departments(id),
  cost_center_id INTEGER REFERENCES cost_centers(id),
  attachment VARCHAR(255),
  status VARCHAR(20) DEFAULT 'posted',
  je_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_transfers_transfer_no ON transfers(transfer_no);
CREATE INDEX IF NOT EXISTS idx_transfers_date ON transfers(transfer_date);
CREATE INDEX IF NOT EXISTS idx_transfers_from_account ON transfers(from_account_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to_account ON transfers(to_account_id);

-- Update timestamp trigger
DROP TRIGGER IF EXISTS trg_transfers_updated ON transfers;
CREATE TRIGGER trg_transfers_updated 
  BEFORE UPDATE ON transfers 
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- 2. Configure Document Number Profile
INSERT INTO code_sequences (entity_type, prefix, padding, next_value, format_pattern, active, description)
VALUES ('transfer', 'TR', 6, 1, 'PREFIX-SEQ', true, 'Internal Funds Transfer Engine Sequence')
ON CONFLICT (entity_type) DO NOTHING;

COMMIT;
