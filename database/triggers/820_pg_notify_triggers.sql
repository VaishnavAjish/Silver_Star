-- ============================================================
-- PostgreSQL NOTIFY Triggers for Real-Time Event Pipeline
-- These fire pg_notify() which pgNotifyListener.js consumes.
-- Channel name format: {table}_{OPERATION}
-- ============================================================

CREATE OR REPLACE FUNCTION notify_table_change()
RETURNS TRIGGER AS $$
DECLARE
  payload JSON;
  channel TEXT;
BEGIN
  channel := TG_TABLE_NAME || '_' || TG_OP;

  IF TG_OP = 'DELETE' THEN
    payload := json_build_object(
      'table',     TG_TABLE_NAME,
      'operation', TG_OP,
      'timestamp', NOW(),
      'old',       row_to_json(OLD)
    );
  ELSE
    payload := json_build_object(
      'table',     TG_TABLE_NAME,
      'operation', TG_OP,
      'timestamp', NOW(),
      'new',       row_to_json(NEW)
    );
  END IF;

  -- pg_notify payload max is 8000 bytes; truncate if needed
  PERFORM pg_notify(channel, LEFT(payload::text, 7900));
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Helper macro to attach the trigger to a table
CREATE OR REPLACE FUNCTION create_notify_trigger(tbl TEXT)
RETURNS VOID AS $$
BEGIN
  EXECUTE format(
    'DROP TRIGGER IF EXISTS trg_notify_%1$s ON %1$I;
     CREATE TRIGGER trg_notify_%1$s
     AFTER INSERT OR UPDATE OR DELETE ON %1$I
     FOR EACH ROW EXECUTE FUNCTION notify_table_change();',
    tbl
  );
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables that pgNotifyListener.js monitors
SELECT create_notify_trigger(t) FROM unnest(ARRAY[
  'inventory',
  'journal_entries',
  'purchase_notes',
  'invoices',
  'payments',
  'receipts',
  'expenses',
  'accounts',
  'items',
  'vendors',
  'customers',
  'users',
  'user_roles',
  'role_permissions',
  'process_transactions',
  'rough_growth',
  'departments',
  'locations',
  'machines',
  'fixed_assets',
  'fixed_asset_categories',
  'audit_logs',
  'lot_movements',
  'cost_centers',
  'growth_runs',
  'bank_reconciliation',
  'bank_deposits',
  'asset_templates',
  'depreciation_runs',
  'je_allocations',
  'machine_processes',
  'process_master',
  'user_permissions',
  'user_dashboard_widgets',
  'user_preferences'
]) AS t;

-- Clean up helper (it was only needed above)
DROP FUNCTION create_notify_trigger(TEXT);
