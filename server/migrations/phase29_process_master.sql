-- ============================================================
-- Phase 29: Process Master — configurable manufacturing process types
-- Run ONCE: psql $DATABASE_URL -f phase29_process_master.sql
-- Safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING guards).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS process_master (
  id                      SERIAL PRIMARY KEY,
  process_code            VARCHAR(50)  UNIQUE NOT NULL,
  process_name            VARCHAR(100) NOT NULL,
  category                VARCHAR(20)  NOT NULL DEFAULT 'PRIMARY'
                          CHECK (category IN ('PRIMARY','SUPPORT','QC','OTHER')),
  requires_inventory      BOOLEAN      NOT NULL DEFAULT true,
  requires_machine        BOOLEAN      NOT NULL DEFAULT true,
  requires_operator       BOOLEAN      NOT NULL DEFAULT false,
  requires_runtime        BOOLEAN      NOT NULL DEFAULT false,
  requires_expected_yield BOOLEAN      NOT NULL DEFAULT false,
  allows_consumables      BOOLEAN      NOT NULL DEFAULT false,
  output_type             VARCHAR(20)  NOT NULL DEFAULT 'NONE'
                          CHECK (output_type IN ('ROUGH','POLISHED','NONE','CUSTOM')),
  default_runtime_hours   NUMERIC(6,2),
  sort_order              INTEGER      NOT NULL DEFAULT 0,
  active                  BOOLEAN      NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pm_active ON process_master(active);
CREATE INDEX IF NOT EXISTS idx_pm_code   ON process_master(process_code);

-- Seed default process types — existing process_type string values map 1-to-1
INSERT INTO process_master
  (process_code, process_name, category,
   requires_inventory, requires_machine, requires_operator,
   requires_runtime, requires_expected_yield, allows_consumables,
   output_type, default_runtime_hours, sort_order)
VALUES
  ('growth',      'Growth',      'PRIMARY', true,  true,  true,  true,  true,  false, 'ROUGH',    168.0,  10),
  ('seeding',     'Seeding',     'PRIMARY', true,  true,  true,  false, false, false, 'NONE',     null,   20),
  ('cleaning',    'Cleaning',    'SUPPORT', false, true,  true,  true,  false, false, 'NONE',     2.0,    30),
  ('polishing',   'Polishing',   'PRIMARY', true,  true,  true,  true,  true,  false, 'POLISHED', null,   40),
  ('cutting',     'Cutting',     'PRIMARY', true,  true,  true,  true,  true,  false, 'CUSTOM',   null,   50),
  ('testing',     'Testing',     'QC',      true,  true,  false, false, false, false, 'NONE',     null,   60),
  ('maintenance', 'Maintenance', 'SUPPORT', false, true,  false, false, false, false, 'NONE',     null,   70),
  ('other',       'Other',       'OTHER',   true,  true,  false, false, false, false, 'NONE',     null,   80)
ON CONFLICT (process_code) DO NOTHING;

COMMIT;
