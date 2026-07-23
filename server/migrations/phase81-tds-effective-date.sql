-- Phase 81 Migration: Add effective_date to bill_tds_withholdings and backfill from purchase_notes.doc_date

ALTER TABLE bill_tds_withholdings ADD COLUMN IF NOT EXISTS effective_date DATE;

-- Idempotent backfill from related purchase_note doc_date (or created_at fallback if doc_date is missing)
UPDATE bill_tds_withholdings btw
SET effective_date = pn.doc_date::date
FROM purchase_notes pn
WHERE pn.id = btw.purchase_note_id
  AND btw.effective_date IS NULL;

-- Fallback for any orphaned rows (never uses CURRENT_DATE)
UPDATE bill_tds_withholdings
SET effective_date = created_at::date
WHERE effective_date IS NULL;
