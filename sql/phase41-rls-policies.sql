-- Phase 41: Row-Level Security (RLS) Policies
-- Run order: after phase40-encrypt-mfa-secrets.sql
-- Implements RLS on core tables to enforce data isolation

BEGIN;

-- Enable RLS on core tables
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_process_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE growth_run_cycles ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user ID from session variable
-- This is set by the application middleware after authentication
CREATE OR REPLACE FUNCTION current_user_id()
RETURNS INTEGER AS $$
BEGIN
  -- Check if the session variable is set
  IF current_setting('app.current_user_id', true) = '' THEN
    RETURN NULL;
  END IF;
  RETURN current_setting('app.current_user_id')::INTEGER;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS TEXT AS $$
BEGIN
  IF current_setting('app.current_user_role', true) = '' THEN
    RETURN NULL;
  END IF;
  RETURN current_setting('app.current_user_role');
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Policy: inventory - users can see lots in their department or all if admin
CREATE POLICY inventory_select_policy ON inventory
  FOR SELECT USING (
    current_user_role() IN ('super_admin', 'admin')
    OR department_id = (
      SELECT department_id FROM users WHERE id = current_user_id()
    )
    OR location_id IN (
      SELECT l.id FROM locations l
      JOIN departments d ON d.location_id = l.id
      WHERE d.id = (SELECT department_id FROM users WHERE id = current_user_id())
    )
  );

CREATE POLICY inventory_modify_policy ON inventory
  FOR INSERT, UPDATE, DELETE USING (
    current_user_role() IN ('super_admin', 'admin')
    OR department_id = (
      SELECT department_id FROM users WHERE id = current_user_id()
    )
  );

-- Policy: purchase_notes - users can see their department's PNs
CREATE POLICY purchase_notes_select_policy ON purchase_notes
  FOR SELECT USING (
    current_user_role() IN ('super_admin', 'admin')
    OR department_id = (
      SELECT department_id FROM users WHERE id = current_user_id()
    )
    OR vendor_id IN (
      SELECT v.id FROM vendors v
      WHERE v.category = 'internal'
    )
  );

CREATE POLICY purchase_notes_modify_policy ON purchase_notes
  FOR INSERT, UPDATE, DELETE USING (
    current_user_role() IN ('super_admin', 'admin')
    OR department_id = (
      SELECT department_id FROM users WHERE id = current_user_id()
    )
  );

-- Policy: invoices - users can see their department's invoices
CREATE POLICY invoices_select_policy ON invoices
  FOR SELECT USING (
    current_user_role() IN ('super_admin', 'admin')
    OR department_id = (
      SELECT department_id FROM users WHERE id = current_user_id()
    )
  );

CREATE POLICY invoices_modify_policy ON invoices
  FOR INSERT, UPDATE, DELETE USING (
    current_user_role() IN ('super_admin', 'admin')
    OR department_id = (
      SELECT department_id FROM users WHERE id = current_user_id()
    )
  );

-- Policy: journal_entries - users can see their department's JEs
CREATE POLICY journal_entries_select_policy ON journal_entries
  FOR SELECT USING (
    current_user_role() IN ('super_admin', 'admin')
    OR created_by = current_user_id()
    OR source_type IN ('manual') -- Manual JEs visible to all accounting
  );

CREATE POLICY journal_entries_modify_policy ON journal_entries
  FOR INSERT, UPDATE, DELETE USING (
    current_user_role() IN ('super_admin', 'admin')
    OR created_by = current_user_id()
  );

-- Policy: users - users can see themselves, admins see all
CREATE POLICY users_select_policy ON users
  FOR SELECT USING (
    current_user_role() IN ('super_admin', 'admin')
    OR id = current_user_id()
  );

CREATE POLICY users_modify_policy ON users
  FOR INSERT, UPDATE, DELETE USING (
    current_user_role() IN ('super_admin', 'admin')
  );

-- Policy: vendors - all authenticated users can read, admin can modify
CREATE POLICY vendors_select_policy ON vendors
  FOR SELECT USING (
    current_user_role() IS NOT NULL
  );

CREATE POLICY vendors_modify_policy ON vendors
  FOR INSERT, UPDATE, DELETE USING (
    current_user_role() IN ('super_admin', 'admin')
  );

-- Policy: customers - all authenticated users can read, admin can modify
CREATE POLICY customers_select_policy ON customers
  FOR SELECT USING (
    current_user_role() IS NOT NULL
  );

CREATE POLICY customers_modify_policy ON customers
  FOR INSERT, UPDATE, DELETE USING (
    current_user_role() IN ('super_admin', 'admin')
  );

-- Policy: fixed_assets - department isolation
CREATE POLICY fixed_assets_select_policy ON fixed_assets
  FOR SELECT USING (
    current_user_role() IN ('super_admin', 'admin')
    OR department_id = (
      SELECT department_id FROM users WHERE id = current_user_id()
    )
  );

CREATE POLICY fixed_assets_modify_policy ON fixed_assets
  FOR INSERT, UPDATE, DELETE USING (
    current_user_role() IN ('super_admin', 'admin')
    OR department_id = (
      SELECT department_id FROM users WHERE id = current_user_id()
    )
  );

-- Policy: lot_process_issues - department isolation
CREATE POLICY lot_process_issues_select_policy ON lot_process_issues
  FOR SELECT USING (
    current_user_role() IN ('super_admin', 'admin')
    OR source_lot_id IN (
      SELECT id FROM inventory WHERE department_id = (
        SELECT department_id FROM users WHERE id = current_user_id()
      )
    )
  );

CREATE POLICY lot_process_issues_modify_policy ON lot_process_issues
  FOR INSERT, UPDATE, DELETE USING (
    current_user_role() IN ('super_admin', 'admin')
    OR source_lot_id IN (
      SELECT id FROM inventory WHERE department_id = (
        SELECT department_id FROM users WHERE id = current_user_id()
      )
    )
  );

-- Policy: lot_movements - department isolation
CREATE POLICY lot_movements_select_policy ON lot_movements
  FOR SELECT USING (
    current_user_role() IN ('super_admin', 'admin')
    OR created_by = current_user_id()
  );

CREATE POLICY lot_movements_modify_policy ON lot_movements
  FOR INSERT, UPDATE, DELETE USING (
    current_user_role() IN ('super_admin', 'admin')
    OR created_by = current_user_id()
  );

-- Policy: machine_processes - operator sees their processes, admin all
CREATE POLICY machine_processes_select_policy ON machine_processes
  FOR SELECT USING (
    current_user_role() IN ('super_admin', 'admin')
    OR operator_id = current_user_id()
    OR machine_id IN (
      SELECT m.id FROM machines m
      JOIN departments d ON m.department_id = d.id
      WHERE d.id = (SELECT department_id FROM users WHERE id = current_user_id())
    )
  );

CREATE POLICY machine_processes_modify_policy ON machine_processes
  FOR INSERT, UPDATE, DELETE USING (
    current_user_role() IN ('super_admin', 'admin')
    OR operator_id = current_user_id()
  );

-- Policy: growth_run_cycles - department isolation via machine process
CREATE POLICY growth_run_cycles_select_policy ON growth_run_cycles
  FOR SELECT USING (
    current_user_role() IN ('super_admin', 'admin')
    OR growth_run_id IN (
      SELECT id FROM inventory WHERE department_id = (
        SELECT department_id FROM users WHERE id = current_user_id()
      )
    )
  );

CREATE POLICY growth_run_cycles_modify_policy ON growth_run_cycles
  FOR INSERT, UPDATE, DELETE USING (
    current_user_role() IN ('super_admin', 'admin')
    OR growth_run_id IN (
      SELECT id FROM inventory WHERE department_id = (
        SELECT department_id FROM users WHERE id = current_user_id()
      )
    )
  );

COMMIT;