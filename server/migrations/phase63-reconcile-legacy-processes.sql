BEGIN;

-- 1. Transfer configurations from legacy to new canonical processes
UPDATE process_master SET process_group = 'GROWTH', eligible_machine_type = 'CVD_REACTOR' WHERE process_code = 'growth';
UPDATE process_master SET process_group = 'LASER', eligible_machine_type = 'LASER' WHERE process_code IN ('edge_cut', 'block_cut', 'outer_cut', 'seed_remove');

-- 2. Deactivate legacy processes (Soft Delete)
-- This removes them from dropdowns but preserves historical FK integrity and lets the 72 pr-01 runs finish cleanly.
UPDATE process_master
SET active = false, sort_order = 999
WHERE process_code IN ('pr-01', 'pr-02', 'pr-03', 'pr-04', 'pr-05');

-- 3. Resolve Final Block (Rename pr-06 to final_block since it has 0 references)
UPDATE process_master
SET 
  process_code = 'final_block',
  process_name = 'Final Block',
  process_group = 'LASER',
  eligible_machine_type = 'LASER',
  completion_mode = 'OUTPUT_BASED',
  active = true,
  sort_order = 57,
  allowed_outputs = (SELECT allowed_outputs FROM process_master WHERE process_code = 'block_cut')
WHERE process_code = 'pr-06';

COMMIT;
