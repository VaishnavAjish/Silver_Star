-- Migration: Growth Run Numbering System (Beta-1 Architecture Upgrade)
-- Objective: Add run_no to inventory, create machine-monthly sequence table, and backfill.

BEGIN;

-- 1. Add run_no column to inventory (for Growth Runs)
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS run_no INT DEFAULT 1;

-- 2. Create monthly sequence table
CREATE TABLE IF NOT EXISTS growth_monthly_seqs (
    machine_code VARCHAR(50) NOT NULL,
    year_month VARCHAR(10) NOT NULL,
    last_val INT NOT NULL DEFAULT 0,
    PRIMARY KEY (machine_code, year_month)
);

-- 3. Backfill run_no for existing Growth Runs based on historical "growth_again" events
UPDATE inventory i
SET run_no = 1 + (
    SELECT COUNT(*) 
    FROM lot_op_log l 
    WHERE l.lot_id = i.id AND l.operation_type = 'growth_again'
)
WHERE item_id IN (SELECT id FROM items WHERE category = 'growth_run');

COMMIT;
