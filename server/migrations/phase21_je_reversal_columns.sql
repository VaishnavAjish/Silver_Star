-- ============================================================
-- PHASE 21 — JE REVERSAL TRACKING COLUMNS
-- Adds reversal metadata to journal_entries so the engine can:
--   1. Mark original JEs as is_reversed after reversal
--   2. Link reversal JEs back to the original (reversal_of_je_id)
--   3. Clean up je_allocations when a JE is reversed
--
-- SAFE: all IF NOT EXISTS — can be re-run without harm.
-- ============================================================

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS reversal_of_je_id INTEGER REFERENCES journal_entries(id),
  ADD COLUMN IF NOT EXISTS is_reversed        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reversed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by        INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_je_reversal_of
  ON journal_entries (reversal_of_je_id)
  WHERE reversal_of_je_id IS NOT NULL;

-- ── Back-fill existing reversals (idempotent) ─────────────────────────────────
-- Any JE with source_type = 'reversal' or 'edit_reversal' is linked to its original.
UPDATE journal_entries
SET    reversal_of_je_id = source_id
WHERE  source_type IN ('reversal', 'edit_reversal')
  AND  source_id          IS NOT NULL
  AND  reversal_of_je_id  IS NULL;

-- Mark originals as reversed wherever a reversal JE points at them.
UPDATE journal_entries orig
SET    is_reversed = TRUE
WHERE  EXISTS (
  SELECT 1
  FROM   journal_entries rev
  WHERE  rev.source_type IN ('reversal', 'edit_reversal')
    AND  rev.source_id = orig.id
)
AND is_reversed = FALSE;
