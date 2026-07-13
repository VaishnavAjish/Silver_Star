-- ============================================================
-- Phase 56: Return Engine Stabilization (allowed_outputs)
-- ============================================================

BEGIN;

ALTER TABLE process_master
  ADD COLUMN IF NOT EXISTS allowed_outputs JSONB DEFAULT '[]'::jsonb;

-- Growth Run Outputs
UPDATE process_master SET allowed_outputs = '[
  { "type": "usable",    "label": "Partial Growth Run", "suffix": "R", "status": "IN STOCK", "item_category_override": "growth_run" },
  { "type": "damaged",   "label": "Damaged",            "suffix": "D", "status": "DAMAGED" },
  { "type": "consumed",  "label": "Consumed",           "suffix": "C", "status": "CONSUMED" },
  { "type": "qc_hold",   "label": "QC Hold",            "suffix": "Q", "status": "QC_HOLD" }
]'::jsonb
WHERE process_code = 'growth';

-- Laser Outputs
UPDATE process_master SET allowed_outputs = '[
  { "type": "usable",    "label": "Growth Diamond", "suffix": "R", "status": "IN STOCK", "item_category_override": "growth_diamond" },
  { "type": "reprocess", "label": "Recovered Seed", "suffix": "S", "status": "IN STOCK", "item_category_override": "seed" },
  { "type": "damaged",   "label": "Damaged",        "suffix": "D", "status": "DAMAGED" },
  { "type": "consumed",  "label": "Consumed",       "suffix": "C", "status": "CONSUMED" },
  { "type": "qc_hold",   "label": "QC Hold",        "suffix": "Q", "status": "QC_HOLD" }
]'::jsonb
WHERE process_code = 'laser';

-- Edge Cut Outputs
UPDATE process_master SET allowed_outputs = '[
  { "type": "usable",    "label": "Growth Diamond", "suffix": "R", "status": "IN STOCK", "item_category_override": "growth_diamond" },
  { "type": "damaged",   "label": "Damaged",        "suffix": "D", "status": "DAMAGED" },
  { "type": "consumed",  "label": "Consumed",       "suffix": "C", "status": "CONSUMED" }
]'::jsonb
WHERE process_code = 'edge_cut';

-- Block Cut Outputs
UPDATE process_master SET allowed_outputs = '[
  { "type": "usable",    "label": "Growth Diamond", "suffix": "R", "status": "IN STOCK", "item_category_override": "growth_diamond" },
  { "type": "damaged",   "label": "Damaged",        "suffix": "D", "status": "DAMAGED" },
  { "type": "consumed",  "label": "Consumed",       "suffix": "C", "status": "CONSUMED" }
]'::jsonb
WHERE process_code = 'block_cut';

-- Outer Cut Outputs
UPDATE process_master SET allowed_outputs = '[
  { "type": "usable",    "label": "Growth Diamond", "suffix": "R", "status": "IN STOCK", "item_category_override": "growth_diamond" },
  { "type": "damaged",   "label": "Damaged",        "suffix": "D", "status": "DAMAGED" },
  { "type": "consumed",  "label": "Consumed",       "suffix": "C", "status": "CONSUMED" }
]'::jsonb
WHERE process_code = 'outer_cut';

-- Seed Remove Outputs
UPDATE process_master SET allowed_outputs = '[
  { "type": "reprocess", "label": "Recovered Seed", "suffix": "S", "status": "IN STOCK", "item_category_override": "seed" },
  { "type": "usable",    "label": "Growth Diamond", "suffix": "R", "status": "IN STOCK", "item_category_override": "growth_diamond" },
  { "type": "damaged",   "label": "Damaged",        "suffix": "D", "status": "DAMAGED" },
  { "type": "consumed",  "label": "Consumed",       "suffix": "C", "status": "CONSUMED" }
]'::jsonb
WHERE process_code = 'seed_remove';

-- For Polishing (Legacy)
UPDATE process_master SET allowed_outputs = '[
  { "type": "usable",    "label": "Polished Diamond", "suffix": "R", "status": "IN STOCK", "item_category_override": "polished" },
  { "type": "damaged",   "label": "Damaged",          "suffix": "D", "status": "DAMAGED" },
  { "type": "consumed",  "label": "Consumed",         "suffix": "C", "status": "CONSUMED" }
]'::jsonb
WHERE process_code = 'polishing';

-- General fallback for others
UPDATE process_master SET allowed_outputs = '[
  { "type": "usable",    "label": "Usable",   "suffix": "R", "status": "IN STOCK" },
  { "type": "damaged",   "label": "Damaged",  "suffix": "D", "status": "DAMAGED" },
  { "type": "consumed",  "label": "Consumed", "suffix": "C", "status": "CONSUMED" }
]'::jsonb
WHERE allowed_outputs = '[]'::jsonb OR allowed_outputs IS NULL;

COMMIT;
