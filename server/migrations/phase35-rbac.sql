-- ============================================================
-- SILVERSTAR GROW — Role-Based Access Control (RBAC) System
-- Phase 35: Roles, permissions, user-role assignments, audit
-- ============================================================

-- ── 1. ROLES TABLE ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  is_system   BOOLEAN DEFAULT FALSE,
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roles_slug ON roles(slug);
CREATE INDEX IF NOT EXISTS idx_roles_active ON roles(is_active);

-- ── 2. ROLE PERMISSIONS (bitmask) ─────────────────────────────
-- permissions are stored as integer bitmask:
--   VIEW=1, CREATE=2, EDIT=4, DELETE=8, APPROVE=16, EXPORT=32, PRINT=64
CREATE TABLE IF NOT EXISTS role_permissions (
  id          SERIAL PRIMARY KEY,
  role_id     INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  module      VARCHAR(100) NOT NULL,
  submodule   VARCHAR(100) NOT NULL DEFAULT '',
  permissions INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(role_id, module, submodule)
);

CREATE INDEX IF NOT EXISTS idx_role_perms_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_perms_module ON role_permissions(module);

-- ── 3. USER-ROLE ASSIGNMENTS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS user_roles (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON user_roles(role_id);

-- ── 4. PERMISSION AUDIT LOGS ─────────────────────────────────
CREATE TABLE IF NOT EXISTS permission_audit_logs (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(50) NOT NULL,
  target_type VARCHAR(50) NOT NULL,
  target_id   INTEGER,
  changes     JSONB,
  ip_address  VARCHAR(45),
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_target ON permission_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON permission_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON permission_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON permission_audit_logs(created_at);

-- ── 5. SEED SYSTEM ROLES ─────────────────────────────────────
INSERT INTO roles (name, slug, description, is_system) VALUES
  ('Administrator', 'admin', 'Full system access — all modules, all actions', TRUE),
  ('Operator', 'operator', 'Day-to-day operations — create and edit transactions', TRUE),
  ('Viewer', 'viewer', 'Read-only access — view records and print reports', TRUE)
ON CONFLICT (slug) DO NOTHING;

-- ── 6. SEED ROLE PERMISSIONS (matching ROLE_DEFAULTS) ──────
-- Permission bits: VIEW=1 CREATE=2 EDIT=4 DELETE=8 APPROVE=16 EXPORT=32 PRINT=64

-- Operator: day-to-day ops (view + create + edit on most modules, export on reports/inventory)
INSERT INTO role_permissions (role_id, module, submodule, permissions)
SELECT r.id, m.module, m.submodule, m.permissions
FROM roles r
CROSS JOIN (VALUES
  ('dashboard',      '',       1),
  ('inventory',      '',       103),  -- VIEW|CREATE|EDIT|EXPORT|PRINT
  ('purchase',       '',       71),   -- VIEW|CREATE|EDIT|PRINT
  ('sales',          '',       71),   -- VIEW|CREATE|EDIT|PRINT
  ('process',        '',       7),    -- VIEW|CREATE|EDIT
  ('rough',          '',       7),    -- VIEW|CREATE|EDIT
  ('assets',         '',       65),   -- VIEW|PRINT
  ('accounting',     '',       7),    -- VIEW|CREATE|EDIT
  ('reports',        '',       97),   -- VIEW|EXPORT|PRINT
  ('management',     '',       1),
  ('manufacturing',  '',       7)     -- VIEW|CREATE|EDIT
) AS m(module, submodule, permissions)
WHERE r.slug = 'operator'
ON CONFLICT (role_id, module, submodule) DO UPDATE SET permissions = EXCLUDED.permissions;

-- Viewer: read-only (view + print on certain modules)
INSERT INTO role_permissions (role_id, module, submodule, permissions)
SELECT r.id, m.module, m.submodule, m.permissions
FROM roles r
CROSS JOIN (VALUES
  ('dashboard',      '',       1),
  ('inventory',      '',       65),   -- VIEW|PRINT
  ('purchase',       '',       65),   -- VIEW|PRINT
  ('sales',          '',       65),   -- VIEW|PRINT
  ('process',        '',       1),
  ('rough',          '',       1),
  ('assets',         '',       1),
  ('accounting',     '',       1),
  ('reports',        '',       65),   -- VIEW|PRINT
  ('management',     '',       1),
  ('manufacturing',  '',       1)
) AS m(module, submodule, permissions)
WHERE r.slug = 'viewer'
ON CONFLICT (role_id, module, submodule) DO UPDATE SET permissions = EXCLUDED.permissions;
