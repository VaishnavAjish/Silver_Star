-- Phase 38: Enterprise RBAC — Super Admin role + new modules + permission bits
-- =========================================================================

-- 1. Update the admin user's legacy role to super_admin
UPDATE users
SET role = 'super_admin'
WHERE username = 'admin'
  AND role = 'admin';

-- 2. Assign the Super Admin RBAC role to the admin user
INSERT INTO user_roles (user_id, role_id, assigned_by)
SELECT u.id, r.id, u.id
FROM users u
CROSS JOIN roles r
WHERE u.username = 'admin'
  AND r.slug = 'super_admin'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id
  );

-- 3. Auto-assign Super Admin to any user whose legacy role is super_admin
INSERT INTO user_roles (user_id, role_id, assigned_by)
SELECT u.id, r.id, u.id
FROM users u
CROSS JOIN roles r
WHERE u.role = 'super_admin'
  AND r.slug = 'super_admin'
  AND NOT EXISTS (
    SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = r.id
  );

-- 4. Seed role_permissions for new modules (hr, finance, master_data)
-- These will be skipped via ON CONFLICT if already present.
INSERT INTO role_permissions (role_id, module, submodule, permissions)
SELECT r.id, m.module, m.submodule, m.permissions
FROM roles r
CROSS JOIN (VALUES
  ('hr',          '',     1023),  -- super_admin: full access
  ('finance',     '',     1023),
  ('master_data', '',     1023)
) AS m(module, submodule, permissions)
WHERE r.slug = 'super_admin'
ON CONFLICT (role_id, module, submodule) DO NOTHING;

INSERT INTO role_permissions (role_id, module, submodule, permissions)
SELECT r.id, m.module, m.submodule, m.permissions
FROM roles r
CROSS JOIN (VALUES
  ('hr',          '',     1023),  -- admin: full access
  ('finance',     '',     1023),
  ('master_data', '',     1023)
) AS m(module, submodule, permissions)
WHERE r.slug = 'admin'
ON CONFLICT (role_id, module, submodule) DO NOTHING;

INSERT INTO role_permissions (role_id, module, submodule, permissions)
SELECT r.id, m.module, m.submodule, m.permissions
FROM roles r
CROSS JOIN (VALUES
  ('hr',          '',     0),     -- operator: no access by default
  ('finance',     '',     0),
  ('master_data', '',     7)      -- view+create+edit
) AS m(module, submodule, permissions)
WHERE r.slug = 'operator'
ON CONFLICT (role_id, module, submodule) DO NOTHING;

INSERT INTO role_permissions (role_id, module, submodule, permissions)
SELECT r.id, m.module, m.submodule, m.permissions
FROM roles r
CROSS JOIN (VALUES
  ('hr',          '',     0),     -- viewer: no access by default
  ('finance',     '',     0),
  ('master_data', '',     1)      -- view only
) AS m(module, submodule, permissions)
WHERE r.slug = 'viewer'
ON CONFLICT (role_id, module, submodule) DO NOTHING;

-- 5. Seed submodule-level permissions for admin panel submodules
INSERT INTO role_permissions (role_id, module, submodule, permissions)
SELECT r.id, 'admin', 'audit_logs', 1023
FROM roles r
WHERE r.slug IN ('super_admin', 'admin')
ON CONFLICT (role_id, module, submodule) DO NOTHING;

INSERT INTO role_permissions (role_id, module, submodule, permissions)
SELECT r.id, 'admin', 'roles', 1023
FROM roles r
WHERE r.slug IN ('super_admin', 'admin')
ON CONFLICT (role_id, module, submodule) DO NOTHING;

INSERT INTO role_permissions (role_id, module, submodule, permissions)
SELECT r.id, 'admin', 'settings', 1023
FROM roles r
WHERE r.slug IN ('super_admin')
ON CONFLICT (role_id, module, submodule) DO NOTHING;
