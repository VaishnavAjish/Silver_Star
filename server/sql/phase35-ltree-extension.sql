-- Phase 35: ltree Extension for Genealogy Path Optimization
-- Run order: after phase34-critical-indexes.sql
-- Enables efficient hierarchical queries on inventory.genealogy_path

BEGIN;

-- Enable ltree extension for hierarchical path queries
CREATE EXTENSION IF NOT EXISTS ltree;

-- Add ltree column for efficient path operations
-- This will be populated from existing genealogy_path (text) values
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS genealogy_ltree ltree;

-- Populate genealogy_ltree from existing genealogy_path
-- genealogy_path format: '1001/1001-A/1001-A-1' -> ltree: '1001.1001-A.1001-A-1'
UPDATE inventory
SET genealogy_ltree = replace(genealogy_path, '/', '.')::ltree
WHERE genealogy_path IS NOT NULL AND genealogy_ltree IS NULL;

-- Create GIST index for fast ancestor/descendant queries
CREATE INDEX IF NOT EXISTS idx_inventory_genealogy_ltree
  ON inventory USING GIST (genealogy_ltree);

-- Create partial index for active lots only
CREATE INDEX IF NOT EXISTS idx_inventory_genealogy_ltree_active
  ON inventory USING GIST (genealogy_ltree)
  WHERE status IN ('IN STOCK', 'IN PROCESS', 'LOW STOCK');

COMMIT;