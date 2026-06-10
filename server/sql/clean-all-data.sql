-- ============================================================
-- SILVERSTAR GROW — Clean ALL Demo Data
-- Wipes every table, resets every sequence, restores admin user.
-- Schema (tables, indexes, functions, triggers) is NOT touched.
--
-- Usage:
--   psql -U postgres -d silverstar_grow -f sql/clean-all-data.sql
-- ============================================================

BEGIN;

-- ── Refresh materialized views after we clear data (do before truncate so they don't block)
DO $$
BEGIN
  IF to_regclass('mv_dashboard_financial') IS NOT NULL THEN
    REFRESH MATERIALIZED VIEW mv_dashboard_financial;
  END IF;
  IF to_regclass('mv_trial_balance') IS NOT NULL THEN
    REFRESH MATERIALIZED VIEW mv_trial_balance;
  END IF;
END $$;

-- ── Truncate every table with CASCADE (handles all FK references automatically)
DO $$
DECLARE
  tbl TEXT;
  all_tables TEXT[] := ARRAY[
    -- Logs / audit
    'audit_log',
    'api_logs',
    'session_log',
    'permission_audit_logs',

    -- Auth / session
    'refresh_tokens',
    'user_dashboard_widgets',
    'user_clipboard',
    'user_preferences',
    'user_permissions',
    'user_roles',
    'role_permissions',
    'roles',

    -- Allocations / sub-lines
    'receipt_allocations',
    'payment_allocations',
    'expense_allocations',
    'expense_lines',
    'je_allocations',
    'bank_reconciliation_lines',

    -- Stock transfers
    'pending_transfer_lots',
    'pending_transfers',

    -- Documents: lines before headers
    'invoice_lines',
    'purchase_note_lines',
    'rough_growth_lines',
    'process_transaction_lines',
    'depreciation_run_lines',
    'bank_deposit_lines',
    'process_return_lines',

    -- Document headers
    'invoices',
    'purchase_notes',
    'rough_growth',
    'process_transactions',
    'depreciation_runs',
    'bank_deposits',
    'expenses',
    'receipts',
    'payments',
    'bank_reconciliation',

    -- Inventory & lot tracking
    'lot_mix_components',
    'lot_movement_children',
    'lot_movement_parents',
    'lot_movements',
    'lot_process_issues',
    'lot_process_returns',
    'lot_op_log',
    'inventory_closing_override',
    'inventory_opening',
    'inventory',

    -- Manufacturing
    'machine_process_materials',
    'machine_process_lots',
    'machine_processes',
    'machine_status_logs',
    'process_master',

    -- Accounting
    'je_lines',
    'journal_entries',

    -- Advances
    'customer_advances',
    'vendor_advances',

    -- Fixed assets
    'fixed_asset_gst_ledger',
    'fixed_assets',
    'fixed_asset_categories',
    'asset_templates',

    -- Master data
    'customers',
    'vendors',
    'items',
    'expense_categories',
    'machines',
    'departments',
    'locations',
    'uom',
    'cost_centers',
    'code_sequences',
    'accounts',

    -- Users last
    'users'
  ];
BEGIN
  FOREACH tbl IN ARRAY all_tables LOOP
    IF to_regclass(tbl) IS NOT NULL THEN
      EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', tbl);
    END IF;
  END LOOP;
END $$;

-- ── Reset all document / lot sequences to their original start values ─────────
DO $$
DECLARE
  seq_name TEXT;
  seq_start BIGINT;
  seq_pairs TEXT[][] := ARRAY[
    ['je_seq',         '4001'],
    ['pn_seq',         '2050'],
    ['inv_seq',        '3001'],
    ['exp_seq',        '1001'],
    ['ps_seq',         '1001'],
    ['pr_seq',         '1001'],
    ['gr_seq',         '1001'],
    ['rd_seq',         '1001'],
    ['pay_seq',        '1001'],
    ['rct_seq',        '1001'],
    ['lm_seq',         '1001'],
    ['fa_seq',         '1001'],
    ['seed_lot_seq',   '1001'],
    ['seed_mix_seq',      '1'],
    ['lot_op_id_seq',  '100001']
  ];
  pair TEXT[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY seq_pairs LOOP
    seq_name  := pair[1];
    seq_start := pair[2]::BIGINT;
    IF to_regclass(seq_name) IS NOT NULL THEN
      EXECUTE format('ALTER SEQUENCE %I RESTART WITH %s', seq_name, seq_start);
    END IF;
  END LOOP;
END $$;

-- ── Restore code_sequences config (system numbering config, not demo data) ────
INSERT INTO code_sequences
  (entity_type,   prefix, separator, period_scope, padding, format_pattern,      editable_policy, description)
VALUES
  ('vendor',      'VND',  '-',       'none',        6,      'PREFIX-SEQ',         'user_override', 'Vendor master code'),
  ('customer',    'CUS',  '-',       'none',        6,      'PREFIX-SEQ',         'user_override', 'Customer master code'),
  ('fixed_asset', 'FA',   '-',       'month',       4,      'PREFIX-YYYYMM-SEQ',  'auto',          'Fixed asset code'),
  ('bank_deposit','BD',   '-',       'none',        6,      'PREFIX-SEQ',         'auto',          'Bank deposit document number')
ON CONFLICT (entity_type) DO NOTHING;

-- ── Restore admin user (password: admin123) ───────────────────────────────────
INSERT INTO users (username, email, password_hash, full_name, role)
VALUES (
  'admin',
  'admin@silverstargrow.com',
  crypt('admin123', gen_salt('bf')),
  'System Administrator',
  'admin'
);

COMMIT;

-- ── Verification summary ──────────────────────────────────────────────────────
SELECT
  schemaname,
  relname                        AS table_name,
  n_live_tup                     AS row_count
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY relname;
