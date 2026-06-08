-- ============================================================
-- SILVERSTAR GROW — Full Database Deployment
-- ============================================================
-- Run: psql -U postgres -d silverstar_grow -f deploy.sql
-- ============================================================

BEGIN;
SET statement_timeout = '300s';

-- Track deployment start
SELECT NOW() AS deploy_start \gset

-- ============================================================
-- CORE
-- ============================================================
\ir schema/core/000_core_extensions.sql
\ir schema/migrations/000_migration_tracker.sql

-- ============================================================
-- MASTER DATA TABLES
-- ============================================================
\ir schema/master/010_users.sql
\ir schema/master/040_vendors.sql
\ir schema/master/050_locations_departments.sql
\ir schema/master/060_machines_uom_expense.sql

-- ============================================================
-- INVENTORY
-- ============================================================
\ir schema/inventory/030_items.sql
\ir schema/inventory/080_inventory.sql

-- ============================================================
-- PURCHASE
-- ============================================================
\ir schema/purchase/070_purchase_orders.sql

-- ============================================================
-- SALES
-- ============================================================
\ir schema/sales/100_sales_orders.sql

-- ============================================================
-- PROCESS / MANUFACTURING
-- ============================================================
\ir schema/process/090_production_batches.sql
\ir schema/process/110_growth_cycles.sql

-- ============================================================
-- ACCOUNTING
-- ============================================================
\ir schema/accounting/020_accounting_core.sql

-- ============================================================
-- AUDIT
-- ============================================================
\ir schema/audit/120_audit_logs.sql

-- ============================================================
-- INDEXES, FUNCTIONS, TRIGGERS, PROCEDURES
-- ============================================================
\ir indexes/900_performance_indexes.sql
\ir functions/800_stock_balance_funcs.sql
\ir triggers/810_auto_stock_account.sql
\ir procedures/900_accounting_procedures.sql

-- ============================================================
-- SEED DATA
-- ============================================================
\ir seeds/001_seed_data.sql

-- ============================================================
-- RECORD MIGRATION
-- ============================================================
INSERT INTO schema_migrations (version, filename, description, md5_hash, applied_by)
VALUES (
  '1.0.0',
  'deploy.sql',
  'Full database deployment v1.0.0',
  md5(current_database() || ':' || '1.0.0'),
  current_user
);

COMMIT;

SELECT NOW() AS deploy_end \gset
SELECT AGE(:'deploy_end'::timestamptz, :'deploy_start'::timestamptz) AS deploy_duration;
