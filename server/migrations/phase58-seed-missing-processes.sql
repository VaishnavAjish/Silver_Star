-- ============================================================
-- Phase 58: Seed Missing Native Processes
-- ============================================================
-- Inserts the standard Silverstar process codes that are required 
-- for the Return Engine and component mode tagging to function.
-- (This resolves the issue where only pr-01 through pr-05 existed).

BEGIN;

INSERT INTO process_master
  (process_code, process_name, category,
   requires_inventory, requires_machine, requires_operator,
   requires_runtime, requires_expected_yield, allows_consumables,
   output_type, default_runtime_hours, sort_order, completion_mode)
VALUES
  -- Growth Run process (from phase 29)
  ('growth',      'Growth',      'PRIMARY', true,  true,  true,  true,  true,  false, 'ROUGH',    168.0,  10, 'RETURN_BASED'),
  ('seeding',     'Seeding',     'PRIMARY', true,  true,  true,  false, false, false, 'NONE',     null,   20, 'OUTPUT_BASED'),
  ('cleaning',    'Cleaning',    'SUPPORT', false, true,  true,  true,  false, false, 'NONE',     2.0,    30, 'RETURN_BASED'),
  ('polishing',   'Polishing',   'PRIMARY', true,  true,  true,  true,  true,  false, 'POLISHED', null,   40, 'OUTPUT_BASED'),
  ('cutting',     'Cutting',     'PRIMARY', true,  true,  true,  true,  true,  false, 'CUSTOM',   null,   50, 'OUTPUT_BASED'),
  ('testing',     'Testing',     'QC',      true,  true,  false, false, false, false, 'NONE',     null,   60, 'OUTPUT_BASED'),
  
  -- Laser processes (from phase 32)
  ('laser',       'Laser',       'PRIMARY', true,  true,  true,  true,  true,  false, 'ROUGH',    1.0,    51, 'OUTPUT_BASED'),
  ('edge_cut',    'Edge Cut',    'PRIMARY', true,  true,  true,  true,  true,  false, 'ROUGH',    1.0,    52, 'OUTPUT_BASED'),
  ('outer_cut',   'Outer Cut',   'PRIMARY', true,  true,  true,  true,  true,  false, 'ROUGH',    1.0,    53, 'OUTPUT_BASED'),
  ('block_cut',   'Block Cut',   'PRIMARY', true,  true,  true,  true,  true,  false, 'ROUGH',    1.5,    54, 'OUTPUT_BASED'),
  ('seed_remove', 'Seed Remove', 'PRIMARY', true,  true,  true,  true,  false, false, 'ROUGH',    0.5,    55, 'OUTPUT_BASED'),
  ('growth_cut',  'Growth Cut',  'PRIMARY', true,  true,  true,  true,  true,  false, 'ROUGH',    2.0,    56, 'OUTPUT_BASED')
ON CONFLICT (process_code) DO NOTHING;

COMMIT;
