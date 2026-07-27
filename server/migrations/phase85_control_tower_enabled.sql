-- Phase 85: Control Tower Monitored-Machine Scope Correction
-- Adds `control_tower_enabled` flag to machines and removes Laser machines from live monitoring

BEGIN;

-- 1. Add the new column
ALTER TABLE machines ADD COLUMN IF NOT EXISTS control_tower_enabled BOOLEAN DEFAULT true;

-- 2. Update Laser machines to disable them in Control Tower
UPDATE machines 
SET control_tower_enabled = false 
WHERE type = 'LASER' OR code LIKE 'LS-%' OR name IN ('LS-01', 'LS-02', 'LS-03', 'LS-04', 'LS-05');

-- 3. Update Process Master so Laser processes no longer require machine selection
UPDATE process_master
SET requires_machine = false
WHERE process_group = 'LASER';

COMMIT;
