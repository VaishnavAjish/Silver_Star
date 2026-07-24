-- ============================================================
-- Phase 82: Inventory Security Scope — Restricted Operator
-- Additive: reuses existing RBAC tables; adds only two new
-- scope tables and the operator_restricted role preset.
-- Idempotent: safe to re-run.
-- ============================================================

BEGIN;

-- ── 1. USER INVENTORY SCOPE (one row per restricted user) ────

CREATE TABLE IF NOT EXISTS user_inventory_scopes (
  user_id            INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  scope_mode         VARCHAR(20) NOT NULL DEFAULT 'ALL'
                       CHECK (scope_mode IN ('ALL', 'SELECTED', 'NONE')),
  include_unassigned BOOLEAN NOT NULL DEFAULT FALSE,
  created_by         INT REFERENCES users(id),
  updated_by         INT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_inv_scopes_user
  ON user_inventory_scopes(user_id);

-- ── 2. SELECTED-SCOPE DEPARTMENT WHITELIST ────────────────────

CREATE TABLE IF NOT EXISTS user_inventory_scope_depts (
  user_id       INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id INT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_user_inv_scope_depts_user
  ON user_inventory_scope_depts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_inv_scope_depts_dept
  ON user_inventory_scope_depts(department_id);

-- ── 3. OPERATOR_RESTRICTED SYSTEM ROLE ───────────────────────
-- View-only role: no financial fields (enforced in service layer),
-- no create/edit/export/print. Admin configures department scope
-- separately via user_inventory_scopes.

INSERT INTO roles (name, slug, description, is_system)
VALUES (
  'Restricted Operator',
  'operator_restricted',
  'View-only operator: financial fields hidden, department-scoped inventory. '
  'No create, edit, export or print actions.',
  TRUE
)
ON CONFLICT (slug) DO UPDATE SET
  name        = EXCLUDED.name,
  description = EXCLUDED.description,
  updated_at  = NOW();

-- ── 4. ROLE PERMISSIONS FOR OPERATOR_RESTRICTED ──────────────
-- Permission bits: VIEW=1 only.
-- Financial visibility is NOT a bitmask here — it is enforced
-- by the service layer via the absence of canViewFinancial.
-- Modules not listed here return 0 (denied) by default.

INSERT INTO role_permissions (role_id, module, submodule, permissions)
SELECT r.id, m.module, '', m.permissions
FROM roles r
CROSS JOIN (VALUES
  ('dashboard',      1),   -- VIEW only
  ('inventory',      1),   -- VIEW only; no export/print
  ('process',        1),   -- VIEW only
  ('manufacturing',  1),   -- VIEW only
  ('rough',          1)    -- VIEW only (Growth Runs visible by default)
) AS m(module, permissions)
WHERE r.slug = 'operator_restricted'
ON CONFLICT (role_id, module, submodule) DO UPDATE
  SET permissions = EXCLUDED.permissions,
      updated_at  = NOW();

-- ── 5. VERIFY (informational — no action) ────────────────────
-- After migration, confirm:
--   SELECT slug, description FROM roles WHERE slug = 'operator_restricted';
--   SELECT module, permissions FROM role_permissions
--     JOIN roles ON roles.id = role_permissions.role_id
--   WHERE roles.slug = 'operator_restricted';

COMMIT;
