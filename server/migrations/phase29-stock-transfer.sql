-- Stock Transfer Sequence
CREATE SEQUENCE IF NOT EXISTS st_seq START 1001;

-- Ensure inventory has location_id column (should already exist)
-- Add index on location_id for faster filtering
CREATE INDEX IF NOT EXISTS idx_inventory_location_id ON inventory(location_id);

-- Allow viewing transfers in lot_movements
-- movement_type 'transfer' is already supported by the existing enum/pattern
