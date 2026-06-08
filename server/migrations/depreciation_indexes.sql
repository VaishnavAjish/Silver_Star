-- ═══════════════════════════════════════════════════════════════════════════════
-- Depreciation & Fixed-Assets Performance Indexes
-- Run once:
--   psql -U postgres -d silverstar_grow -f server/migrations/depreciation_indexes.sql
-- ═══════════════════════════════════════════════════════════════════════════════

-- depreciation_run_lines.run_id — used in JOIN/GROUP BY and correlated subqueries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_depr_run_lines_run_id
  ON depreciation_run_lines(run_id);

-- depreciation_run_lines.fixed_asset_id — used in cancel-run query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_depr_run_lines_asset_id
  ON depreciation_run_lines(fixed_asset_id);

-- depreciation_runs.je_id — used in LEFT JOIN journal_entries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_depr_runs_je_id
  ON depreciation_runs(je_id);

-- depreciation_runs.created_at DESC — used in ORDER BY on the list query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_depr_runs_created_at
  ON depreciation_runs(created_at DESC);

-- depreciation_runs.status — used in cancel-run lateral query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_depr_runs_status_period
  ON depreciation_runs(status, period_from);

-- fixed_assets — status filter used on every preview/create run
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fixed_assets_status
  ON fixed_assets(status);

-- fixed_assets — category_id used in JOINs
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fixed_assets_category_id
  ON fixed_assets(category_id);
