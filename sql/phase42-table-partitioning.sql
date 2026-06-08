-- Phase 42: Table Partitioning for Large Tables
-- Run order: after phase41-rls-policies.sql
-- Partitions inventory, journal_entries, lot_op_log by year

BEGIN;

-- ============================================================
-- 1. Partition inventory table by purchase_date (yearly)
-- ============================================================

-- Create partitioned table structure
CREATE TABLE IF NOT EXISTS inventory_partitioned (
  LIKE inventory INCLUDING ALL
) PARTITION BY RANGE (purchase_date);

-- Create yearly partitions for the last 5 years + current + next
DO $$
DECLARE
  start_year INT := EXTRACT(YEAR FROM CURRENT_DATE) - 5;
  end_year INT := EXTRACT(YEAR FROM CURRENT_DATE) + 1;
  partition_name TEXT;
  partition_start DATE;
  partition_end DATE;
BEGIN
  FOR yr IN start_year..end_year LOOP
    partition_name := 'inventory_' || yr;
    partition_start := MAKE_DATE(yr, 1, 1);
    partition_end := MAKE_DATE(yr + 1, 1, 1);
    
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF inventory_partitioned FOR VALUES FROM (%L) TO (%L)',
      partition_name, partition_start, partition_end);
  END LOOP;
END $$;

-- Create default partition for out-of-range dates
CREATE TABLE IF NOT EXISTS inventory_default PARTITION OF inventory_partitioned DEFAULT;

-- Copy data from inventory to inventory_partitioned
INSERT INTO inventory_partitioned SELECT * FROM inventory;

-- Swap tables (requires brief lock)
-- ALTER TABLE inventory RENAME TO inventory_old;
-- ALTER TABLE inventory_partitioned RENAME TO inventory;

-- ============================================================
-- 2. Partition journal_entries by date (yearly)
-- ============================================================

CREATE TABLE IF NOT EXISTS journal_entries_partitioned (
  LIKE journal_entries INCLUDING ALL
) PARTITION BY RANGE (date);

DO $$
DECLARE
  start_year INT := EXTRACT(YEAR FROM CURRENT_DATE) - 5;
  end_year INT := EXTRACT(YEAR FROM CURRENT_DATE) + 1;
  partition_name TEXT;
  partition_start DATE;
  partition_end DATE;
BEGIN
  FOR yr IN start_year..end_year LOOP
    partition_name := 'journal_entries_' || yr;
    partition_start := MAKE_DATE(yr, 1, 1);
    partition_end := MAKE_DATE(yr + 1, 1, 1);
    
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF journal_entries_partitioned FOR VALUES FROM (%L) TO (%L)',
      partition_name, partition_start, partition_end);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS journal_entries_default PARTITION OF journal_entries_partitioned DEFAULT;

INSERT INTO journal_entries_partitioned SELECT * FROM journal_entries;

-- ============================================================
-- 3. Partition lot_op_log by performed_at (yearly)
-- ============================================================

CREATE TABLE IF NOT EXISTS lot_op_log_partitioned (
  LIKE lot_op_log INCLUDING ALL
) PARTITION BY RANGE (performed_at);

DO $$
DECLARE
  start_year INT := EXTRACT(YEAR FROM CURRENT_DATE) - 5;
  end_year INT := EXTRACT(YEAR FROM CURRENT_DATE) + 1;
  partition_name TEXT;
  partition_start DATE;
  partition_end DATE;
BEGIN
  FOR yr IN start_year..end_year LOOP
    partition_name := 'lot_op_log_' || yr;
    partition_start := MAKE_DATE(yr, 1, 1);
    partition_end := MAKE_DATE(yr + 1, 1, 1);
    
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF lot_op_log_partitioned FOR VALUES FROM (%L) TO (%L)',
      partition_name, partition_start, partition_end);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS lot_op_log_default PARTITION OF lot_op_log_partitioned DEFAULT;

INSERT INTO lot_op_log_partitioned SELECT * FROM lot_op_log;

-- ============================================================
-- 4. Create indexes on partitioned tables
-- ============================================================

-- Inventory partitions indexes (created on each partition automatically in PG11+)
-- Need to create on parent for PG10, but in PG11+ they propagate

-- Journal entries indexes
-- Note: For partitioned tables, indexes must be created on each partition
-- This is a manual step after partition creation

-- lot_op_log indexes
-- Same as above

COMMIT;