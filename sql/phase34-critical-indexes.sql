-- Phase 34: Critical Indexes for Performance
-- Run order: after phase28-code-engine.sql
-- Adds composite and partial indexes for high-traffic queries

BEGIN;

-- ── 1. Inventory list query indexes (fixes C3) ─────────────────────────────────
-- Most common filter: status = 'IN STOCK' + category
CREATE INDEX IF NOT EXISTS idx_inventory_status_category
  ON inventory (status, category) WHERE status = 'IN STOCK';

-- Machine process lookup for growth runs
CREATE INDEX IF NOT EXISTS idx_inventory_machine_process
  ON inventory (machine_process_id) WHERE machine_process_id IS NOT NULL;

-- Location + department filters
CREATE INDEX IF NOT EXISTS idx_inventory_location_dept
  ON inventory (location_id, department_id);

-- Vendor filter
CREATE INDEX IF NOT EXISTS idx_inventory_vendor
  ON inventory (vendor_id) WHERE vendor_id IS NOT NULL;

-- ── 2. Lot operation log index (fixes L1) ───────────────────────────────────────
-- Used by /api/inventory/:id/history - orders by performed_at DESC
CREATE INDEX IF NOT EXISTS idx_lot_op_log_lot_performed
  ON lot_op_log (lot_id, performed_at DESC);

-- ── 3. Journal entries indexes ──────────────────────────────────────────────────
-- Date range + status filter for reports/dashboard
CREATE INDEX IF NOT EXISTS idx_journal_entries_date_status
  ON journal_entries (date, status);

-- Source type + source id for lookups
CREATE INDEX IF NOT EXISTS idx_journal_entries_source
  ON journal_entries (source_type, source_id);

-- ── 4. Purchase notes indexes ───────────────────────────────────────────────────
-- Vendor + date range
CREATE INDEX IF NOT EXISTS idx_purchase_notes_vendor_date
  ON purchase_notes (vendor_id, doc_date);

-- Status filter
CREATE INDEX IF NOT EXISTS idx_purchase_notes_status
  ON purchase_notes (status) WHERE status != 'cancelled';

-- ── 5. Lot movements indexes ────────────────────────────────────────────────────
-- Parent/child lookups for split/mix
CREATE INDEX IF NOT EXISTS idx_lot_movement_parents_lot
  ON lot_movement_parents (parent_lot_id);
CREATE INDEX IF NOT EXISTS idx_lot_movement_children_lot
  ON lot_movement_children (child_lot_id);

-- ── 6. Process issues indexes ───────────────────────────────────────────────────
-- Source lot + status
CREATE INDEX IF NOT EXISTS idx_lot_process_issues_source_status
  ON lot_process_issues (source_lot_id, status) WHERE status = 'OPEN';

-- Machine process link
CREATE INDEX IF NOT EXISTS idx_lot_process_issues_machine
  ON lot_process_issues (machine_process_id) WHERE machine_process_id IS NOT NULL;

-- ── 7. Growth run cycles index ──────────────────────────────────────────────────
-- Growth run + cycle ordering
CREATE INDEX IF NOT EXISTS idx_growth_run_cycles_run_cycle
  ON growth_run_cycles (growth_run_id, cycle_no);

-- ── 8. Fixed assets indexes ─────────────────────────────────────────────────────
-- Category + status for depreciation runs
CREATE INDEX IF NOT EXISTS idx_fixed_assets_category_status
  ON fixed_assets (category_id, status) WHERE status = 'active';

-- Purchase note link
CREATE INDEX IF NOT EXISTS idx_fixed_assets_purchase_note
  ON fixed_assets (purchase_note_id) WHERE purchase_note_id IS NOT NULL;

COMMIT;