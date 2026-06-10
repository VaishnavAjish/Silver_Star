-- Phase 21: Fix purchase_notes balance_due data inconsistency
-- ─────────────────────────────────────────────────────────────────────────────
-- Problem: Some purchase_notes records have balance_due = 0 even when no
-- payments were made (e.g. FA capital asset bills created before the balance_due
-- INSERT fix). payment_allocations is the authoritative source of truth.
--
-- This migration is fully IDEMPOTENT — it only touches rows where the stored
-- values differ from the values computed from payment_allocations.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- Recompute amount_paid, balance_due, payment_status for every non-cancelled
-- purchase note where the stored values don't match the actual allocations.
UPDATE purchase_notes pn
SET
  amount_paid    = corrected.total_paid,
  balance_due    = corrected.correct_balance,
  payment_status = CASE
                     WHEN corrected.correct_balance <= 0             THEN 'PAID'
                     WHEN corrected.total_paid > 0                   THEN 'PARTIAL'
                     ELSE                                                 'UNPAID'
                   END
FROM (
  SELECT
    pn2.id,
    COALESCE(pa_agg.total_paid, 0)                                     AS total_paid,
    GREATEST(pn2.grand_total - COALESCE(pa_agg.total_paid, 0), 0)      AS correct_balance
  FROM purchase_notes pn2
  LEFT JOIN (
    SELECT purchase_note_id, SUM(amount) AS total_paid
    FROM   payment_allocations
    GROUP  BY purchase_note_id
  ) pa_agg ON pa_agg.purchase_note_id = pn2.id
  WHERE pn2.status != 'cancelled'
) corrected
WHERE pn.id = corrected.id
  AND (
    pn.balance_due IS DISTINCT FROM corrected.correct_balance
    OR pn.amount_paid IS DISTINCT FROM corrected.total_paid
  );

-- Verification — show what was affected (runs inside the same transaction)
SELECT
  pn.id,
  pn.doc_number,
  pn.grand_total,
  pn.amount_paid,
  pn.balance_due,
  pn.payment_status
FROM purchase_notes pn
WHERE pn.status != 'cancelled'
ORDER BY pn.id;

COMMIT;
