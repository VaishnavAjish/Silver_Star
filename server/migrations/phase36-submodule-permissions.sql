-- ================================================================
-- SILVERSTAR GROW — Phase 36: Granular Submodule Permissions
-- Seeds submodule-level bitmasks for the Operator role.
--
-- Bit values:
--   VIEW=1  CREATE=2  EDIT=4  DELETE=8  APPROVE=16  EXPORT=32  PRINT=64
--
-- Common masks used below:
--   127 = ALL  (1+2+4+8+16+32+64)
--   119 = no DELETE  (1+2+4+16+32+64)
--   113 = VIEW+APPROVE+EXPORT+PRINT  (1+16+32+64)
--   111 = no APPROVE  (1+2+4+8+32+64)
--    97 = VIEW+EXPORT+PRINT  (1+32+64)
-- ================================================================

DO $$
DECLARE
  op_id INTEGER;
BEGIN
  SELECT id INTO op_id FROM roles WHERE slug = 'operator';
  IF op_id IS NULL THEN
    RAISE NOTICE 'Operator role not found — skipping';
    RETURN;
  END IF;

  -- Remove old module-level blanket rows for operator so submodule rows take over
  DELETE FROM role_permissions
  WHERE role_id = op_id AND submodule = '';

  -- ── DASHBOARD ─────────────────────────────────────────────────
  -- VIEW + EXPORT + PRINT = 97
  INSERT INTO role_permissions (role_id, module, submodule, permissions) VALUES
    (op_id, 'dashboard', 'dashboard', 97)
  ON CONFLICT (role_id, module, submodule) DO UPDATE SET permissions = EXCLUDED.permissions;

  -- ── INVENTORY ─────────────────────────────────────────────────
  INSERT INTO role_permissions (role_id, module, submodule, permissions) VALUES
    (op_id, 'inventory', 'all_inventory',  127),  -- FULL
    (op_id, 'inventory', 'items_master',   127),  -- FULL
    (op_id, 'inventory', 'opening_entry',  127),  -- FULL
    (op_id, 'inventory', 'closing_entry',  127),  -- FULL
    (op_id, 'inventory', 'mix_lots',       127),  -- FULL
    (op_id, 'inventory', 'stock_transfer', 111),  -- no APPROVE (1+2+4+8+32+64)
    (op_id, 'inventory', 'lot_movements',  127),  -- FULL
    (op_id, 'inventory', 'process_issues', 127),  -- FULL
    (op_id, 'inventory', 'start_process',  127)   -- FULL
  ON CONFLICT (role_id, module, submodule) DO UPDATE SET permissions = EXCLUDED.permissions;

  -- ── PURCHASE ──────────────────────────────────────────────────
  INSERT INTO role_permissions (role_id, module, submodule, permissions) VALUES
    (op_id, 'purchase', 'vendors',           127),  -- FULL
    (op_id, 'purchase', 'purchase_notes',    127),  -- FULL
    (op_id, 'purchase', 'new_purchase_note', 127),  -- FULL
    (op_id, 'purchase', 'expenses',          127)   -- FULL
  ON CONFLICT (role_id, module, submodule) DO UPDATE SET permissions = EXCLUDED.permissions;

  -- ── PROCESS ───────────────────────────────────────────────────
  INSERT INTO role_permissions (role_id, module, submodule, permissions) VALUES
    (op_id, 'process', 'process_log',          127),  -- FULL
    (op_id, 'process', 'send_to_process',      127),  -- FULL
    (op_id, 'process', 'return_from_process',  127)   -- FULL
  ON CONFLICT (role_id, module, submodule) DO UPDATE SET permissions = EXCLUDED.permissions;

  -- ── ROUGH DIAMONDS ────────────────────────────────────────────
  INSERT INTO role_permissions (role_id, module, submodule, permissions) VALUES
    (op_id, 'rough', 'rough_growth',     127),  -- FULL
    (op_id, 'rough', 'new_growth_entry', 127)   -- FULL
  ON CONFLICT (role_id, module, submodule) DO UPDATE SET permissions = EXCLUDED.permissions;

  -- ── SALES ─────────────────────────────────────────────────────
  INSERT INTO role_permissions (role_id, module, submodule, permissions) VALUES
    (op_id, 'sales', 'invoice',     127),  -- FULL
    (op_id, 'sales', 'new_invoice', 127),  -- FULL
    (op_id, 'sales', 'customers',   127)   -- FULL
  ON CONFLICT (role_id, module, submodule) DO UPDATE SET permissions = EXCLUDED.permissions;

  -- ── ACCOUNTING ────────────────────────────────────────────────
  -- Journal Entries: no DELETE → 119 (1+2+4+16+32+64)
  -- Bank Deposits:   VIEW+APPROVE+EXPORT+PRINT only → 113 (1+16+32+64)
  INSERT INTO role_permissions (role_id, module, submodule, permissions) VALUES
    (op_id, 'accounting', 'chart_of_accounts',   127),  -- FULL
    (op_id, 'accounting', 'journal_entries',      119),  -- no DELETE
    (op_id, 'accounting', 'payments',             127),  -- FULL
    (op_id, 'accounting', 'receipts',             127),  -- FULL
    (op_id, 'accounting', 'bank_deposits',        113),  -- VIEW+APPROVE+EXPORT+PRINT
    (op_id, 'accounting', 'depreciation_runs',    127),  -- FULL
    (op_id, 'accounting', 'new_depreciation_run', 127)   -- FULL
  ON CONFLICT (role_id, module, submodule) DO UPDATE SET permissions = EXCLUDED.permissions;

  -- ── FIXED ASSETS ──────────────────────────────────────────────
  INSERT INTO role_permissions (role_id, module, submodule, permissions) VALUES
    (op_id, 'assets', 'asset_list',   127),  -- FULL
    (op_id, 'assets', 'manual_entry', 127)   -- FULL
  ON CONFLICT (role_id, module, submodule) DO UPDATE SET permissions = EXCLUDED.permissions;

  -- ── REPORTS ───────────────────────────────────────────────────
  -- Read-only reports: VIEW+EXPORT+PRINT = 97
  -- Operational reports: FULL = 127
  -- No-delete reports: 119
  INSERT INTO role_permissions (role_id, module, submodule, permissions) VALUES
    (op_id, 'reports', 'ledger',                97),   -- VIEW+EXPORT+PRINT
    (op_id, 'reports', 'trial_balance',         97),   -- VIEW+EXPORT+PRINT
    (op_id, 'reports', 'profit_loss',           97),   -- VIEW+EXPORT+PRINT
    (op_id, 'reports', 'costing_report',        97),   -- VIEW+EXPORT+PRINT
    (op_id, 'reports', 'balance_sheet',         97),   -- VIEW+EXPORT+PRINT
    (op_id, 'reports', 'fixed_asset_register',  97),   -- VIEW+EXPORT+PRINT
    (op_id, 'reports', 'depreciation_schedule', 127),  -- FULL
    (op_id, 'reports', 'accounts_receivable',   127),  -- FULL
    (op_id, 'reports', 'accounts_payable',      97),   -- VIEW+EXPORT+PRINT
    (op_id, 'reports', 'bank_reconciliation',   119),  -- no DELETE
    (op_id, 'reports', 'cost_center_pl',        119)   -- no DELETE
  ON CONFLICT (role_id, module, submodule) DO UPDATE SET permissions = EXCLUDED.permissions;

  -- ── MANUFACTURING ─────────────────────────────────────────────
  -- No DELETE on any manufacturing master data → 119
  INSERT INTO role_permissions (role_id, module, submodule, permissions) VALUES
    (op_id, 'manufacturing', 'control_tower',      119),  -- no DELETE
    (op_id, 'manufacturing', 'process_master',     119),  -- no DELETE
    (op_id, 'manufacturing', 'machines',           119),  -- no DELETE
    (op_id, 'manufacturing', 'departments',        119),  -- no DELETE
    (op_id, 'manufacturing', 'locations',          119),  -- no DELETE
    (op_id, 'manufacturing', 'uom',                119),  -- no DELETE
    (op_id, 'manufacturing', 'expense_categories', 119),  -- no DELETE
    (op_id, 'manufacturing', 'asset_categories',   119)   -- no DELETE
  ON CONFLICT (role_id, module, submodule) DO UPDATE SET permissions = EXCLUDED.permissions;

  -- ── ADMIN PANEL ───────────────────────────────────────────────
  -- No DELETE on users → 119
  INSERT INTO role_permissions (role_id, module, submodule, permissions) VALUES
    (op_id, 'admin', 'users', 119)  -- no DELETE
  ON CONFLICT (role_id, module, submodule) DO UPDATE SET permissions = EXCLUDED.permissions;

  -- ── CLIPBOARD ─────────────────────────────────────────────────
  -- No DELETE → 119
  INSERT INTO role_permissions (role_id, module, submodule, permissions) VALUES
    (op_id, 'clipboard', 'clipboard', 119)  -- no DELETE
  ON CONFLICT (role_id, module, submodule) DO UPDATE SET permissions = EXCLUDED.permissions;

  RAISE NOTICE 'Operator submodule permissions seeded successfully (% rows upserted)', 51;
END;
$$;

-- ── Verification query (run after migration to confirm) ───────────
-- SELECT module, submodule, permissions,
--   (CASE WHEN permissions & 1  = 1  THEN 'V' ELSE '-' END) ||
--   (CASE WHEN permissions & 2  = 2  THEN 'C' ELSE '-' END) ||
--   (CASE WHEN permissions & 4  = 4  THEN 'E' ELSE '-' END) ||
--   (CASE WHEN permissions & 8  = 8  THEN 'D' ELSE '-' END) ||
--   (CASE WHEN permissions & 16 = 16 THEN 'A' ELSE '-' END) ||
--   (CASE WHEN permissions & 32 = 32 THEN 'X' ELSE '-' END) ||
--   (CASE WHEN permissions & 64 = 64 THEN 'P' ELSE '-' END) AS bits
-- FROM role_permissions
-- WHERE role_id = (SELECT id FROM roles WHERE slug = 'operator')
-- ORDER BY module, submodule;
