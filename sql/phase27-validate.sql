-- ============================================================
-- SILVERSTAR GROW — Phase 27: Post-Reset Validation Queries
-- Run AFTER phase27-inventory-reset.sql + phase27-status-consolidation.sql
-- All inventory/process counts should be 0.
-- All accounting/master counts should be > 0 (unchanged).
-- ============================================================

-- ── Part A: Inventory tables (all must be 0 after reset) ─────
SELECT 'inventory'                 AS tbl, COUNT(*) AS row_count FROM inventory
UNION ALL
SELECT 'lot_movements',                     COUNT(*) FROM lot_movements
UNION ALL
SELECT 'lot_movement_parents',              COUNT(*) FROM lot_movement_parents
UNION ALL
SELECT 'lot_movement_children',             COUNT(*) FROM lot_movement_children
UNION ALL
SELECT 'lot_mix_components',                COUNT(*) FROM lot_mix_components
UNION ALL
SELECT 'lot_process_issues',                COUNT(*) FROM lot_process_issues
UNION ALL
SELECT 'lot_process_returns',               COUNT(*) FROM lot_process_returns
UNION ALL
SELECT 'lot_op_log',                        COUNT(*) FROM lot_op_log
UNION ALL
SELECT 'rough_growth',                      COUNT(*) FROM rough_growth
UNION ALL
SELECT 'rough_growth_lines',                COUNT(*) FROM rough_growth_lines
UNION ALL
SELECT 'process_transactions',              COUNT(*) FROM process_transactions
UNION ALL
SELECT 'process_transaction_lines',         COUNT(*) FROM process_transaction_lines
ORDER BY tbl;

-- ── Part B: Accounting / master tables (must all be > 0) ─────
SELECT 'accounts'          AS tbl, COUNT(*) AS row_count FROM accounts
UNION ALL
SELECT 'journal_entries',           COUNT(*) FROM journal_entries
UNION ALL
SELECT 'je_lines',                  COUNT(*) FROM je_lines
UNION ALL
SELECT 'purchase_notes',            COUNT(*) FROM purchase_notes
UNION ALL
SELECT 'purchase_note_lines',       COUNT(*) FROM purchase_note_lines
UNION ALL
SELECT 'vendors',                   COUNT(*) FROM vendors
UNION ALL
SELECT 'customers',                 COUNT(*) FROM customers
UNION ALL
SELECT 'items',                     COUNT(*) FROM items
UNION ALL
SELECT 'locations',                 COUNT(*) FROM locations
UNION ALL
SELECT 'departments',               COUNT(*) FROM departments
UNION ALL
SELECT 'machines',                  COUNT(*) FROM machines
ORDER BY tbl;

-- ── Part C: Orphan / referential integrity checks ─────────────

-- purchase_note_lines with inventory_id still set (should be 0 after reset)
SELECT 'pnlines_with_inventory_id' AS check_name, COUNT(*) AS cnt
  FROM purchase_note_lines
 WHERE inventory_id IS NOT NULL;

-- inventory rows with non-null parent_lot_id or root_lot_id (should be 0)
SELECT 'inventory_with_dangling_parent' AS check_name, COUNT(*) AS cnt
  FROM inventory
 WHERE parent_lot_id IS NOT NULL OR root_lot_id IS NOT NULL;

-- inventory rows with non-null source_movement_id (should be 0)
SELECT 'inventory_with_source_movement' AS check_name, COUNT(*) AS cnt
  FROM inventory
 WHERE source_movement_id IS NOT NULL;

-- ── Part D: Status constraint verification ────────────────────

-- Confirm canonical status CHECK constraint is in place
SELECT conname, pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conname = 'inventory_status_valid';

-- Confirm no disallowed statuses exist in inventory
SELECT status, COUNT(*) AS cnt
  FROM inventory
 WHERE status NOT IN ('IN STOCK','IN PROCESS','CONSUMED','DAMAGED','SOLD','ARCHIVED')
 GROUP BY status;

-- ── Part E: Journal entry balance integrity ───────────────────
-- All posted JEs must remain balanced (debit = credit)
SELECT COUNT(*) AS unbalanced_je_count
  FROM journal_entries
 WHERE status = 'posted'
   AND ABS(total_debit - total_credit) > 0.01;

-- ── Part F: Sequence state verification ──────────────────────
-- Current values of operational sequences after reset
SELECT sequencename, last_value
  FROM pg_sequences
 WHERE sequencename IN (
   'lm_seq','lot_issue_seq','lot_return_seq','lot_op_id_seq',
   'seed_lot_seq','seed_mix_seq','gr_seq','rd_seq','ps_seq','pr_seq'
 )
 ORDER BY sequencename;
