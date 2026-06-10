-- ============================================================
-- SILVERSTAR GROW — Phase 18: Fix AP Reconciliation
-- Root cause: purchaseNotes POST did not set balance_due on
-- bill creation, so all new bills got balance_due = 0 (the
-- column default) instead of grand_total.
--
-- This migration recomputes balance_due, amount_paid, and
-- payment_status for every non-cancelled bill using
-- payment_allocations as the authoritative source of truth.
--
-- Safe to run multiple times (idempotent).
-- Does NOT touch journal_entries or je_lines.
-- ============================================================

UPDATE purchase_notes pn
SET
  amount_paid = COALESCE((
    SELECT SUM(pa.amount)
      FROM payment_allocations pa
     WHERE pa.purchase_note_id = pn.id
  ), 0),

  balance_due = GREATEST(
    pn.grand_total - COALESCE((
      SELECT SUM(pa.amount)
        FROM payment_allocations pa
       WHERE pa.purchase_note_id = pn.id
    ), 0),
    0
  ),

  payment_status = CASE
    WHEN pn.grand_total - COALESCE((
           SELECT SUM(pa.amount)
             FROM payment_allocations pa
            WHERE pa.purchase_note_id = pn.id
         ), 0) <= 0.005
    THEN 'PAID'
    WHEN COALESCE((
           SELECT SUM(pa.amount)
             FROM payment_allocations pa
            WHERE pa.purchase_note_id = pn.id
         ), 0) > 0.005
    THEN 'PARTIAL'
    ELSE 'UNPAID'
  END

WHERE pn.status != 'cancelled';

-- Verify: show summary of recalculated statuses
SELECT payment_status, COUNT(*) AS bill_count, SUM(grand_total) AS total_billed, SUM(balance_due) AS total_outstanding
FROM purchase_notes
WHERE status != 'cancelled'
GROUP BY payment_status
ORDER BY payment_status;
