-- ============================================================
-- SILVERSTAR GROW — Phase 23: Lot Status Refactor
-- Removes SPLIT and MIXED as inventory statuses.
-- Both are operations (recorded in lot_movements), not states.
-- Fully consumed lots (by split or mix) become CONSUMED.
-- ============================================================

-- Migrate existing SPLIT/MIXED lots to CONSUMED
UPDATE inventory SET status = 'CONSUMED', updated_at = NOW()
WHERE status IN ('SPLIT', 'MIXED');

-- Verify
SELECT status, COUNT(*) AS cnt
FROM inventory
GROUP BY status
ORDER BY cnt DESC;
