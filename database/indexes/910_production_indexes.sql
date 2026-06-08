-- ============================================================
-- Production Performance Indexes
-- Run: psql -U postgres -d silverstar_grow -f 910_production_indexes.sql
-- Safe to run multiple times (IF NOT EXISTS on all)
-- ============================================================

-- ── Inventory / Lot lookups (most frequent ERP queries) ───────────────────
CREATE INDEX IF NOT EXISTS idx_inventory_lot_number
  ON inventory(lot_number);

CREATE INDEX IF NOT EXISTS idx_inventory_status
  ON inventory(status)
  WHERE status NOT IN ('closed', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_inventory_item_status
  ON inventory(item_id, status);

CREATE INDEX IF NOT EXISTS idx_inventory_location_status
  ON inventory(location_id, status)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_inventory_created_at
  ON inventory(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_root_lot
  ON inventory(root_lot_id)
  WHERE root_lot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_parent_lot
  ON inventory(parent_lot_id)
  WHERE parent_lot_id IS NOT NULL;

-- ── Lot movements (lineage + workspace queries) ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_lot_movements_lot_id
  ON lot_movements(lot_id);

CREATE INDEX IF NOT EXISTS idx_lot_movements_from_lot
  ON lot_movements(from_lot_id)
  WHERE from_lot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lot_movements_created_at
  ON lot_movements(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lot_movements_movement_type
  ON lot_movements(movement_type, created_at DESC);

-- ── Journal entries (P&L, ledger, and dashboard queries) ─────────────────
CREATE INDEX IF NOT EXISTS idx_journal_entries_date
  ON journal_entries(date DESC);

CREATE INDEX IF NOT EXISTS idx_journal_entries_status_date
  ON journal_entries(status, date DESC)
  WHERE status = 'posted';

CREATE INDEX IF NOT EXISTS idx_je_lines_account_id
  ON je_lines(account_id);

CREATE INDEX IF NOT EXISTS idx_je_lines_account_je
  ON je_lines(account_id, je_id);

-- ── Auth / Session performance ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_username_lower
  ON users(LOWER(username));

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash
  ON refresh_tokens(token_hash)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_expires
  ON refresh_tokens(user_id, expires_at)
  WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_login_attempts_username_ip_time
  ON login_attempts(username, ip_address, created_at DESC)
  WHERE success = false;

-- ── Accounts (chart of accounts + ledger queries) ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_accounts_type
  ON accounts(type)
  WHERE is_group = false;

CREATE INDEX IF NOT EXISTS idx_accounts_code
  ON accounts(code);

-- ── Purchase / Sales (AP/AR aging) ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_purchase_notes_status_date
  ON purchase_notes(status, doc_date DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_notes_vendor
  ON purchase_notes(vendor_id, doc_date DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_status_date
  ON invoices(status, invoice_date DESC);

CREATE INDEX IF NOT EXISTS idx_invoices_customer
  ON invoices(customer_id, invoice_date DESC);

-- ── Payments / Receipts ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payments_date
  ON payments(payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_receipts_date
  ON receipts(receipt_date DESC);

-- ── Growth runs ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_growth_runs_status
  ON growth_runs(status);

CREATE INDEX IF NOT EXISTS idx_growth_runs_start_date
  ON growth_runs(start_date DESC);

-- ── User permissions (permission checks are hot path) ─────────────────────
CREATE INDEX IF NOT EXISTS idx_user_permissions_user_module
  ON user_permissions(user_id, module);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id
  ON user_roles(user_id);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role_module
  ON role_permissions(role_id, module);

-- ── Event outbox (cleanup + polling) ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_sys_event_outbox_created_at
  ON sys_event_outbox(created_at DESC);
