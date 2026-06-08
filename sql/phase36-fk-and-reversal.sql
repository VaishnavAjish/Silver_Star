-- Phase 36: FK on inventory.machine_process_id + JE Reversal Columns
-- Run order: after phase35-ltree-extension.sql

BEGIN;

-- ── 1. Add FK on inventory.machine_process_id (fixes C2) ────────────────────────
-- First, ensure any orphaned biscuits are handled
-- Update orphaned biscuits (where machine_process_id doesn't exist in machine_processes)
UPDATE inventory
SET machine_process_id = NULL
WHERE machine_process_id IS NOT NULL
  AND machine_process_id NOT IN (SELECT id FROM machine_processes);

-- Add the foreign key constraint
ALTER TABLE inventory
  ADD CONSTRAINT fk_inventory_machine_process
  FOREIGN KEY (machine_process_id)
  REFERENCES machine_processes(id)
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- ── 2. Add is_reversed columns to journal_entries (fixes C4) ────────────────────
-- These columns are referenced in journalEntries.js but may not exist
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_of_je_id INTEGER REFERENCES journal_entries(id) ON DELETE SET NULL;

-- Create index for reversal lookups
CREATE INDEX IF NOT EXISTS idx_journal_entries_reversal
  ON journal_entries (reversal_of_je_id) WHERE reversal_of_je_id IS NOT NULL;

COMMIT;