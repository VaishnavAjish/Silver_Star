-- Phase 50: PostgreSQL LISTEN/NOTIFY — Database-Level Event Triggers
-- This migration creates trigger functions and triggers that emit
-- real-time events via pg_notify() whenever data changes in core ERP tables.
-- These events are picked up by the pgNotifyListener service which bridges
-- them into the Socket.IO event system.
-- Safe to run multiple times (idempotent via CREATE OR REPLACE).

-- ══════════════════════════════════════════════════════════════════════════
-- 1. Core trigger function: emits pg_notify on row changes
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION emit_table_change()
RETURNS TRIGGER AS $$
DECLARE
  payload JSONB;
  channel TEXT;
BEGIN
  channel := TG_TABLE_NAME || '_' || TG_OP;
  payload := jsonb_build_object(
    'table',    TG_TABLE_NAME,
    'schema',   TG_TABLE_SCHEMA,
    'operation', TG_OP,
    'timestamp', NOW(),
    'old',      CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN row_to_json(OLD)::jsonb ELSE NULL END,
    'new',      CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN row_to_json(NEW)::jsonb ELSE NULL END
  );
  PERFORM pg_notify(channel, payload::text);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. Per-table AFTER triggers (INSERT/UPDATE/DELETE)
-- ══════════════════════════════════════════════════════════════════════════
-- NOTE: Tables that already have BEFORE UPDATE triggers for updated_at
-- will now have BOTH a BEFORE trigger (updated_at) and an AFTER trigger (notify).
-- The BEFORE trigger still runs first to set updated_at, then AFTER fires.

-- Helper: create notify trigger if table exists
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'inventory') THEN
    DROP TRIGGER IF EXISTS trg_inventory_notify ON inventory;
    CREATE TRIGGER trg_inventory_notify AFTER INSERT OR UPDATE OR DELETE ON inventory FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'journal_entries') THEN
    DROP TRIGGER IF EXISTS trg_journal_entries_notify ON journal_entries;
    CREATE TRIGGER trg_journal_entries_notify AFTER INSERT OR UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'purchase_notes') THEN
    DROP TRIGGER IF EXISTS trg_purchase_notes_notify ON purchase_notes;
    CREATE TRIGGER trg_purchase_notes_notify AFTER INSERT OR UPDATE OR DELETE ON purchase_notes FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'invoices') THEN
    DROP TRIGGER IF EXISTS trg_invoices_notify ON invoices;
    CREATE TRIGGER trg_invoices_notify AFTER INSERT OR UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'payments') THEN
    DROP TRIGGER IF EXISTS trg_payments_notify ON payments;
    CREATE TRIGGER trg_payments_notify AFTER INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'receipts') THEN
    DROP TRIGGER IF EXISTS trg_receipts_notify ON receipts;
    CREATE TRIGGER trg_receipts_notify AFTER INSERT OR UPDATE OR DELETE ON receipts FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'expenses') THEN
    DROP TRIGGER IF EXISTS trg_expenses_notify ON expenses;
    CREATE TRIGGER trg_expenses_notify AFTER INSERT OR UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'accounts') THEN
    DROP TRIGGER IF EXISTS trg_accounts_notify ON accounts;
    CREATE TRIGGER trg_accounts_notify AFTER INSERT OR UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'items') THEN
    DROP TRIGGER IF EXISTS trg_items_notify ON items;
    CREATE TRIGGER trg_items_notify AFTER INSERT OR UPDATE OR DELETE ON items FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'vendors') THEN
    DROP TRIGGER IF EXISTS trg_vendors_notify ON vendors;
    CREATE TRIGGER trg_vendors_notify AFTER INSERT OR UPDATE OR DELETE ON vendors FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'customers') THEN
    DROP TRIGGER IF EXISTS trg_customers_notify ON customers;
    CREATE TRIGGER trg_customers_notify AFTER INSERT OR UPDATE OR DELETE ON customers FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'users') THEN
    DROP TRIGGER IF EXISTS trg_users_notify ON users;
    CREATE TRIGGER trg_users_notify AFTER INSERT OR UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'process_transactions') THEN
    DROP TRIGGER IF EXISTS trg_process_transactions_notify ON process_transactions;
    CREATE TRIGGER trg_process_transactions_notify AFTER INSERT OR UPDATE OR DELETE ON process_transactions FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'rough_growth') THEN
    DROP TRIGGER IF EXISTS trg_rough_growth_notify ON rough_growth;
    CREATE TRIGGER trg_rough_growth_notify AFTER INSERT OR UPDATE OR DELETE ON rough_growth FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'departments') THEN
    DROP TRIGGER IF EXISTS trg_departments_notify ON departments;
    CREATE TRIGGER trg_departments_notify AFTER INSERT OR UPDATE OR DELETE ON departments FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'locations') THEN
    DROP TRIGGER IF EXISTS trg_locations_notify ON locations;
    CREATE TRIGGER trg_locations_notify AFTER INSERT OR UPDATE OR DELETE ON locations FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'machines') THEN
    DROP TRIGGER IF EXISTS trg_machines_notify ON machines;
    CREATE TRIGGER trg_machines_notify AFTER INSERT OR UPDATE OR DELETE ON machines FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'fixed_assets') THEN
    DROP TRIGGER IF EXISTS trg_fixed_assets_notify ON fixed_assets;
    CREATE TRIGGER trg_fixed_assets_notify AFTER INSERT OR UPDATE OR DELETE ON fixed_assets FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'fixed_asset_categories') THEN
    DROP TRIGGER IF EXISTS trg_fixed_asset_categories_notify ON fixed_asset_categories;
    CREATE TRIGGER trg_fixed_asset_categories_notify AFTER INSERT OR UPDATE OR DELETE ON fixed_asset_categories FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'audit_logs') THEN
    DROP TRIGGER IF EXISTS trg_audit_logs_notify ON audit_logs;
    CREATE TRIGGER trg_audit_logs_notify AFTER INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'lot_movements') THEN
    DROP TRIGGER IF EXISTS trg_lot_movements_notify ON lot_movements;
    CREATE TRIGGER trg_lot_movements_notify AFTER INSERT OR UPDATE OR DELETE ON lot_movements FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'cost_centers') THEN
    DROP TRIGGER IF EXISTS trg_cost_centers_notify ON cost_centers;
    CREATE TRIGGER trg_cost_centers_notify AFTER INSERT OR UPDATE OR DELETE ON cost_centers FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'growth_runs') THEN
    DROP TRIGGER IF EXISTS trg_growth_runs_notify ON growth_runs;
    CREATE TRIGGER trg_growth_runs_notify AFTER INSERT OR UPDATE OR DELETE ON growth_runs FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'bank_reconciliation') THEN
    DROP TRIGGER IF EXISTS trg_bank_reconciliation_notify ON bank_reconciliation;
    CREATE TRIGGER trg_bank_reconciliation_notify AFTER INSERT OR UPDATE OR DELETE ON bank_reconciliation FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'user_roles') THEN
    DROP TRIGGER IF EXISTS trg_user_roles_notify ON user_roles;
    CREATE TRIGGER trg_user_roles_notify AFTER INSERT OR UPDATE OR DELETE ON user_roles FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'role_permissions') THEN
    DROP TRIGGER IF EXISTS trg_role_permissions_notify ON role_permissions;
    CREATE TRIGGER trg_role_permissions_notify AFTER INSERT OR UPDATE OR DELETE ON role_permissions FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'bank_deposits') THEN
    DROP TRIGGER IF EXISTS trg_bank_deposits_notify ON bank_deposits;
    CREATE TRIGGER trg_bank_deposits_notify AFTER INSERT OR UPDATE OR DELETE ON bank_deposits FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'asset_templates') THEN
    DROP TRIGGER IF EXISTS trg_asset_templates_notify ON asset_templates;
    CREATE TRIGGER trg_asset_templates_notify AFTER INSERT OR UPDATE OR DELETE ON asset_templates FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'depreciation_runs') THEN
    DROP TRIGGER IF EXISTS trg_depreciation_runs_notify ON depreciation_runs;
    CREATE TRIGGER trg_depreciation_runs_notify AFTER INSERT OR UPDATE OR DELETE ON depreciation_runs FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'je_allocations') THEN
    DROP TRIGGER IF EXISTS trg_je_allocations_notify ON je_allocations;
    CREATE TRIGGER trg_je_allocations_notify AFTER INSERT OR UPDATE OR DELETE ON je_allocations FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'machine_processes') THEN
    DROP TRIGGER IF EXISTS trg_machine_processes_notify ON machine_processes;
    CREATE TRIGGER trg_machine_processes_notify AFTER INSERT OR UPDATE OR DELETE ON machine_processes FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'process_master') THEN
    DROP TRIGGER IF EXISTS trg_process_master_notify ON process_master;
    CREATE TRIGGER trg_process_master_notify AFTER INSERT OR UPDATE OR DELETE ON process_master FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'login_attempts') THEN
    DROP TRIGGER IF EXISTS trg_login_attempts_notify ON login_attempts;
    CREATE TRIGGER trg_login_attempts_notify AFTER INSERT OR UPDATE OR DELETE ON login_attempts FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'refresh_tokens') THEN
    DROP TRIGGER IF EXISTS trg_refresh_tokens_notify ON refresh_tokens;
    CREATE TRIGGER trg_refresh_tokens_notify AFTER INSERT OR UPDATE OR DELETE ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'user_preferences') THEN
    DROP TRIGGER IF EXISTS trg_user_preferences_notify ON user_preferences;
    CREATE TRIGGER trg_user_preferences_notify AFTER INSERT OR UPDATE OR DELETE ON user_preferences FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'user_permissions') THEN
    DROP TRIGGER IF EXISTS trg_user_permissions_notify ON user_permissions;
    CREATE TRIGGER trg_user_permissions_notify AFTER INSERT OR UPDATE OR DELETE ON user_permissions FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
  IF EXISTS (SELECT FROM pg_tables WHERE tablename = 'user_dashboard_widgets') THEN
    DROP TRIGGER IF EXISTS trg_user_dashboard_widgets_notify ON user_dashboard_widgets;
    CREATE TRIGGER trg_user_dashboard_widgets_notify AFTER INSERT OR UPDATE OR DELETE ON user_dashboard_widgets FOR EACH ROW EXECUTE FUNCTION emit_table_change();
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. Verification queries
-- ══════════════════════════════════════════════════════════════════════════
SELECT
  event_object_table AS table_name,
  trigger_name,
  action_timing || ' ' || event_manipulation AS firing
FROM information_schema.triggers
WHERE trigger_name LIKE '%notify'
ORDER BY event_object_table;
