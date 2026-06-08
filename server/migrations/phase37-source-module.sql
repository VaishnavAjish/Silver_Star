-- Phase 37: Add source_module column to inventory
-- Tracks which ERP page/module originally created each lot.

BEGIN;

ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS source_module VARCHAR(100);

-- Backfill existing records from operation_type / source_type
UPDATE inventory
SET source_module = CASE
  WHEN source_type     = 'transfer'      THEN 'Stock Transfer'
  WHEN operation_type  = 'purchase'      THEN 'Purchase Notes'
  WHEN operation_type  = 'mix'           THEN 'Mix Lots'
  WHEN operation_type  = 'split'         THEN 'Split Lot'
  WHEN operation_type  = 'issue'         THEN 'Process Issues'
  WHEN operation_type  = 'return'        THEN 'Return from Process'
  WHEN operation_type  = 'growth_output' THEN 'Rough Growth'
  ELSE 'Manual Entry'
END
WHERE source_module IS NULL;

COMMIT;
