-- Phase 78: Process Master requires_machine flag enforcement & nullability adjustment
-- Relaxes machine_processes.machine_id to allow NULL for machine-less processes
-- Updates canonical Process Master records for Edge Cut, Outer Cut, Seed Remove, and Final Block

BEGIN;

-- 1. Make machine_id in machine_processes nullable
ALTER TABLE machine_processes ALTER COLUMN machine_id DROP NOT NULL;

-- 2. Update approved 4 processes to requires_machine = false
UPDATE process_master
SET requires_machine = false,
    updated_at = NOW()
WHERE process_code IN ('edge_cut', 'outer_cut', 'seed_remove', 'final_block');

COMMIT;
