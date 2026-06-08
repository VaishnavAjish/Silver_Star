-- ═══════════════════════════════════════════════════════════════════════════════
-- Performance Indexes — Phase 32
-- Run: psql -U postgres -d silverstar_grow -f server/migrations/perf_indexes.sql
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. JE Lines — most-queried table for reports, dashboard, ledger
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_je_lines_account_id          ON je_lines(account_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_je_lines_je_id               ON je_lines(je_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_je_lines_cost_center_id      ON je_lines(cost_center_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_je_lines_entity              ON je_lines(entity_type, entity_id);

-- 2. Journal Entries — filtered by status + date in almost every report query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_je_status_posted_date ON journal_entries(status, date) WHERE status = 'posted';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_je_source              ON journal_entries(source_type, source_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_je_date_status         ON journal_entries(date, status);

-- 3. Purchase Notes — AP report, payments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_purchase_notes_vendor_status ON purchase_notes(vendor_id, status, doc_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pn_vendor_date               ON purchase_notes(vendor_id, doc_date DESC);

-- 4. Payment Allocations — AP report join
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_payment_allocations_pn ON payment_allocations(purchase_note_id);

-- 5. Inventory — list queries, genealogy lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_item_id      ON inventory(item_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_vendor_id    ON inventory(vendor_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_parent_lot   ON inventory(parent_lot_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_root_lot     ON inventory(root_lot_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_location     ON inventory(location_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_status       ON inventory(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_lot_code     ON inventory(lot_code);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_lot_op_id    ON inventory(lot_op_id);

-- 6. Items — category/type filters
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_category ON items(category);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_items_type     ON items(type);

-- 7. User permissions — /me endpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_prefs_user       ON user_preferences(user_id);

-- 8. Lot movements — N+1 prevention
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lot_movement_parents_parent ON lot_movement_parents(parent_lot_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lot_movement_children_child ON lot_movement_children(child_lot_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lot_op_log_lot_id           ON lot_op_log(lot_id);

-- 9. Rough growth — costing report
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rough_growth_date_status ON rough_growth(growth_date, status);

-- 10. Machines — manufacturing KPI
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_machines_status ON machines(status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Materialized View for Dashboard — replaces 8 separate aggregation queries
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_dashboard_financial AS
SELECT
  DATE_TRUNC('month', je.date) AS month,
  a.type,
  a.id AS account_id,
  a.code AS account_code,
  a.name AS account_name,
  ROUND(COALESCE(SUM(jl.debit), 0)::numeric, 2) AS total_debit,
  ROUND(COALESCE(SUM(jl.credit), 0)::numeric, 2) AS total_credit
FROM accounts a
JOIN je_lines jl ON jl.account_id = a.id
JOIN journal_entries je ON je.id = jl.je_id
WHERE a.is_group = false AND je.status = 'posted'
  AND je.date >= (DATE_TRUNC('year', NOW()) - INTERVAL '2 years')
GROUP BY DATE_TRUNC('month', je.date), a.type, a.id, a.code, a.name;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_dashboard_financial
ON mv_dashboard_financial(month, account_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Materialized View for Trial Balance
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_trial_balance AS
SELECT
  a.id AS account_id,
  a.code, a.name, a.type, a.is_group,
  ROUND(COALESCE(SUM(jl.debit), 0)::numeric, 2) AS total_debit,
  ROUND(COALESCE(SUM(jl.credit), 0)::numeric, 2) AS total_credit
FROM accounts a
LEFT JOIN je_lines jl ON jl.account_id = a.id
LEFT JOIN journal_entries je ON je.id = jl.je_id AND je.status = 'posted'
WHERE a.is_group = false
GROUP BY a.id, a.code, a.name, a.type, a.is_group;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_trial_balance ON mv_trial_balance(account_id);

-- ═══════════════════════════════════════════════════════════════════════════════
-- BIGINT migration for tables with potential integer overflow
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE expense_categories ALTER COLUMN gl_account_id TYPE BIGINT;
ALTER TABLE purchase_note_lines ALTER COLUMN item_id TYPE BIGINT;
ALTER TABLE invoice_lines ALTER COLUMN item_id TYPE BIGINT;
ALTER TABLE je_lines ALTER COLUMN account_id TYPE BIGINT;
ALTER TABLE je_lines ALTER COLUMN entity_id TYPE BIGINT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Refresh function for materialized views (call via pg_cron or app scheduler)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_financial;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trial_balance;
END;
$$ LANGUAGE plpgsql;
