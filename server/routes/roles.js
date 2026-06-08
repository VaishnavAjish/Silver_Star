const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logger } = require('../middleware/logger');
const { getClientIp } = require('../utils/requestUtils');

const router = express.Router();
const { dispatchEvent } = require('../services/eventDispatcher');

/* ── Permission bit values ─────────────────────────────────── */
const PERM_BITS = {
  view:    1,
  create:  2,
  edit:    4,
  delete:  8,
  approve: 16,
  export:  32,
  print:   64,
  reject:  128,
  import:  256,
  manage:  512,
};
const FULL_ACCESS = 1023;

/* ── Module/submodule tree (shared with frontend) ──────────── */
const MODULE_TREE = [
  { module: 'dashboard',   label: 'Dashboard',    submodules: [{ key: 'dashboard', label: 'Dashboard' }] },
  { module: 'inventory',   label: 'Inventory',
    submodules: [
      { key: 'all_inventory',    label: 'All Inventory' },
      { key: 'items_master',     label: 'Items Master' },
      { key: 'opening_entry',    label: 'Opening Entry' },
      { key: 'closing_entry',    label: 'Closing Entry' },
      { key: 'mix_lots',         label: 'Mix Lots' },
      { key: 'stock_transfer',    label: 'Stock Transfer' },
      { key: 'lot_movements',     label: 'Lot Movements' },
      { key: 'process_issues',    label: 'Process Issues' },
      { key: 'start_process',     label: 'Start Process' },
    ] },
  { module: 'purchase',    label: 'Purchase',
    submodules: [
      { key: 'vendors',              label: 'Vendors' },
      { key: 'purchase_notes',       label: 'Purchase Notes' },
      { key: 'new_purchase_note',    label: 'New Purchase Note' },
      { key: 'expenses',             label: 'Expenses' },
    ] },
  { module: 'process',    label: 'Process',
    submodules: [
      { key: 'process_log',        label: 'Process Log' },
      { key: 'send_to_process',     label: 'Send to Process' },
      { key: 'return_from_process',  label: 'Return from Process' },
    ] },
  { module: 'rough',       label: 'Rough Diamonds',
    submodules: [
      { key: 'rough_growth',      label: 'Rough Growth' },
      { key: 'new_growth_entry',   label: 'New Growth Entry' },
    ] },
  { module: 'sales',       label: 'Sales',
    submodules: [
      { key: 'invoice',     label: 'Invoice' },
      { key: 'new_invoice',  label: 'New Invoice' },
      { key: 'customers',    label: 'Customers' },
    ] },
  { module: 'accounting',  label: 'Accounting',
    submodules: [
      { key: 'chart_of_accounts',  label: 'Chart of Accounts' },
      { key: 'journal_entries',     label: 'Journal Entries' },
      { key: 'payments',            label: 'Payments' },
      { key: 'receipts',            label: 'Receipts' },
      { key: 'bank_deposits',       label: 'Bank Deposits' },
      { key: 'depreciation_runs',   label: 'Depreciation Runs' },
      { key: 'new_depreciation_run', label: 'New Depreciation Run' },
    ] },
  { module: 'assets',     label: 'Fixed Assets',
    submodules: [
      { key: 'asset_list',    label: 'Asset List' },
      { key: 'manual_entry',   label: 'Manual Entry' },
    ] },
  { module: 'reports',     label: 'Reports',
    submodules: [
      { key: 'ledger',               label: 'Ledger' },
      { key: 'trial_balance',         label: 'Trial Balance' },
      { key: 'profit_loss',           label: 'Profit & Loss' },
      { key: 'costing_report',        label: 'Costing Report' },
      { key: 'balance_sheet',         label: 'Balance Sheet' },
      { key: 'fixed_asset_register',  label: 'Fixed Asset Register' },
      { key: 'depreciation_schedule', label: 'Depreciation Schedule' },
      { key: 'accounts_receivable',   label: 'Accounts Receivable' },
      { key: 'accounts_payable',      label: 'Accounts Payable' },
      { key: 'bank_reconciliation',   label: 'Bank Reconciliation' },
      { key: 'cost_center_pl',        label: 'Cost Center P&L' },
    ] },
  { module: 'manufacturing', label: 'Manufacturing',
    submodules: [
      { key: 'control_tower',     label: 'Control Tower' },
      { key: 'process_master',    label: 'Process Master' },
      { key: 'machines',          label: 'Machines' },
      { key: 'departments',       label: 'Departments' },
      { key: 'locations',         label: 'Locations' },
      { key: 'uom',               label: 'UOM' },
      { key: 'expense_categories', label: 'Expense Categories' },
      { key: 'asset_categories',   label: 'Asset Categories' },
    ] },
  { module: 'admin',       label: 'Admin Panel',
    submodules: [
      { key: 'users',       label: 'Users' },
      { key: 'roles',       label: 'Roles & Permissions' },
      { key: 'audit_logs',  label: 'Audit Logs' },
      { key: 'settings',    label: 'Settings' },
    ] },
  { module: 'hr',          label: 'HR',
    submodules: [
      { key: 'employees',  label: 'Employees' },
      { key: 'attendance', label: 'Attendance' },
    ] },
  { module: 'finance',     label: 'Finance',
    submodules: [
      { key: 'budgets',  label: 'Budgets' },
      { key: 'cashflow', label: 'Cash Flow' },
    ] },
  { module: 'master_data', label: 'Master Data',
    submodules: [
      { key: 'departments',        label: 'Departments' },
      { key: 'locations',          label: 'Locations' },
      { key: 'machines',           label: 'Machines' },
      { key: 'uom',                label: 'UOM' },
      { key: 'expense_categories', label: 'Expense Categories' },
      { key: 'asset_categories',   label: 'Asset Categories' },
    ] },
  { module: 'clipboard',   label: 'Clipboard',
    submodules: [
      { key: 'clipboard', label: 'Clipboard' },
    ] },
];

module.exports = { router, MODULE_TREE, PERM_BITS, FULL_ACCESS };

/* ── Role hierarchy (highest → lowest) ───────────────────── */
const ROLE_HIERARCHY = {
  super_admin: 4,
  admin:       3,
  operator:    2,
  viewer:      1,
};

/**
 * Check if the requesting user has authority over the target role.
 * Returns true if the user can manage the target role.
 */
function canManageRole(reqUserRole, targetRoleSlug) {
  const reqLevel = ROLE_HIERARCHY[reqUserRole] ?? 0;
  const targetLevel = ROLE_HIERARCHY[targetRoleSlug] ?? 0;
  // Must have strictly higher level to modify
  return reqLevel > targetLevel;
}

/**
 * Middleware that verifies the requesting user has authority over a role.
 */
function requireRoleAuthority(targetRoleIdParam = 'id') {
  return async (req, res, next) => {
    try {
      const { rows: [targetRole] } = await pool.query(
        'SELECT slug FROM roles WHERE id = $1',
        [req.params[targetRoleIdParam]]
      );
      if (!targetRole) return res.status(404).json({ error: 'Role not found' });

      if (!canManageRole(req.user.role, targetRole.slug)) {
        return res.status(403).json({
          error: `Insufficient authority. Your role cannot modify "${targetRole.slug}".`
        });
      }
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
}

/* ── System role seed — runs on every server startup ──────────────────────── */
// Ensures admin/operator/viewer roles always exist in DB even after a data wipe.
;(async () => {
  try {
    const client = await pool.primaryPool.connect();
    try {
      // Default permission bitmask per module for each role
      const OPERATOR_MODULE_PERMS = {
        dashboard:      1,   // view
        inventory:    103,   // view+create+edit+export+print
        purchase:      71,   // view+create+edit+print
        sales:         71,   // view+create+edit+print
        process:        7,   // view+create+edit
        rough:          7,   // view+create+edit
        assets:        65,   // view+print
        accounting:     7,   // view+create+edit
        reports:       97,   // view+export+print
        management:     1,   // view
        manufacturing:  7,   // view+create+edit
        admin:          0,
        hr:             0,
        finance:        0,
        master_data:    7,   // view+create+edit
        clipboard:      1,   // view
      };
      const VIEWER_MODULE_PERMS = {
        dashboard:      1,   // view
        inventory:     65,   // view+print
        purchase:      65,   // view+print
        sales:         65,   // view+print
        process:        1,   // view
        rough:          1,   // view
        assets:         1,   // view
        accounting:     1,   // view
        reports:       65,   // view+print
        management:     1,   // view
        manufacturing:  1,   // view
        admin:          0,
        hr:             0,
        finance:        0,
        master_data:    1,   // view
        clipboard:      1,   // view
      };

      const SYSTEM_ROLES = [
        { name: 'Super Admin', slug: 'super_admin', description: 'Unrestricted full system access — bypasses all permission checks' },
        { name: 'Admin',       slug: 'admin',       description: 'Full system access' },
        { name: 'Operator',    slug: 'operator',    description: 'Day-to-day operations' },
        { name: 'Viewer',      slug: 'viewer',      description: 'Read-only access' },
      ];

      // Upsert each system role
      for (const sr of SYSTEM_ROLES) {
        await client.query(
          `INSERT INTO roles (name, slug, description, is_system, is_active)
           VALUES ($1, $2, $3, TRUE, TRUE)
           ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, is_system = TRUE, is_active = TRUE`,
          [sr.name, sr.slug, sr.description]
        );
      }

      // Fetch the seeded role IDs
      const { rows: roleRows } = await client.query(
        `SELECT id, slug FROM roles WHERE slug IN ('super_admin','admin','operator','viewer')`
      );
      const roleMap = Object.fromEntries(roleRows.map(r => [r.slug, r.id]));

      // Seed role_permissions for all module:submodule combinations
      for (const mod of MODULE_TREE) {
        for (const sm of (mod.submodules || [])) {
          const superAdminMask = FULL_ACCESS;
          const adminMask      = FULL_ACCESS;
          const operatorMask   = OPERATOR_MODULE_PERMS[mod.module] ?? 0;
          const viewerMask     = VIEWER_MODULE_PERMS[mod.module]   ?? 0;

          for (const [slug, mask] of [['super_admin', superAdminMask], ['admin', adminMask], ['operator', operatorMask], ['viewer', viewerMask]]) {
            const roleId = roleMap[slug];
            if (!roleId) continue;
            await client.query(
              `INSERT INTO role_permissions (role_id, module, submodule, permissions)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (role_id, module, submodule) DO NOTHING`,
              [roleId, mod.module, sm.key, mask]
            );
          }
        }
      }

      // Assign existing users to their matching system role (skip if already assigned)
      for (const [slug, roleId] of Object.entries(roleMap)) {
        if (slug === 'super_admin') continue; // no legacy mapping — assign manually
        await client.query(
          `INSERT INTO user_roles (user_id, role_id)
           SELECT u.id, $1
           FROM users u
           WHERE u.role = $2
             AND NOT EXISTS (
               SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role_id = $1
             )`,
          [roleId, slug]
        );
      }

      logger.info('System roles seeded', { roles: ['super_admin', 'admin', 'operator', 'viewer'] });
    } finally {
      client.release();
    }
  } catch (e) {
    logger.error('System role seed failed', { error: e.message, stack: e.stack });
  }
})();

/* ── Helper: audit log ─────────────────────────────────────── */
async function auditLog(client, userId, action, targetType, targetId, changes, req) {
  await client.query(
    `INSERT INTO permission_audit_logs (user_id, action, target_type, target_id, changes, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, action, targetType, targetId, changes ? JSON.stringify(changes) : null,
     getClientIp?.(req) || req.ip, req.headers['user-agent'] || null]
  );
}

/* ── Helper: compute bitmask from action array ─────────────── */
function actionsToBitmask(actions) {
  let mask = 0;
  if (!actions || !Array.isArray(actions)) return mask;
  for (const a of actions) {
    if (PERM_BITS[a] !== undefined) mask |= PERM_BITS[a];
  }
  return mask;
}

function bitmaskToActions(mask) {
  const actions = [];
  for (const [action, bit] of Object.entries(PERM_BITS)) {
    if ((mask & bit) === bit) actions.push(action);
  }
  return actions;
}

module.exports.actionsToBitmask = actionsToBitmask;
module.exports.bitmaskToActions = bitmaskToActions;
module.exports.auditLog = auditLog;

/* ════════════════════════════════════════════════════════════════
   ROLE CRUD
   ════════════════════════════════════════════════════════════════ */

/* ── GET /roles ────────────────────────────────────────────── */
router.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*,
              (SELECT COUNT(*) FROM user_roles ur WHERE ur.role_id = r.id) AS user_count
       FROM roles r
       WHERE r.is_active = TRUE
       ORDER BY r.is_system DESC, r.name ASC`
    );
    res.json({ data: rows });
  } catch (err) {
    logger.error('Failed to list roles', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /roles ───────────────────────────────────────────── */
router.post('/', authenticate, authorize('admin'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    const { name, slug, description } = req.body;
    if (!name || !slug) return res.status(400).json({ error: 'name and slug are required' });
    if (!/^[a-z0-9_]+$/.test(slug)) return res.status(400).json({ error: 'slug must be lowercase alphanumeric with underscores' });

    await client.query('BEGIN');
    const { rows: [role] } = await client.query(
      `INSERT INTO roles (name, slug, description, is_system) VALUES ($1, $2, $3, FALSE) RETURNING *`,
      [name, slug, description || null]
    );
    await auditLog(client, req.user.id, 'create_role', 'role', role.id,
      { name, slug, description }, req);
    await client.query('COMMIT');

    logger.info('Role created', { roleId: role.id, name, userId: req.user.id });
    
    // Real-Time Sync Engine: Emit event
    dispatchEvent('role.created', { role_id: role.id, name, slug }, 'room:admin').catch(e => logger.error('dispatchEvent failed', { error: e.message, stack: e.stack }));

    res.status(201).json({ data: role });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'A role with this slug already exists' });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ── PUT /roles/:id ────────────────────────────────────────── */
router.put('/:id', authenticate, authorize('admin'), requireRoleAuthority('id'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    const { name, description, is_active } = req.body;
    const { rows: [existing] } = await client.query('SELECT * FROM roles WHERE id = $1', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Role not found' });

    await client.query('BEGIN');
    const { rows: [updated] } = await client.query(
      `UPDATE roles SET name = COALESCE($1, name), description = COALESCE($2, description),
        is_active = COALESCE($3, is_active), updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [name || null, description !== undefined ? description : null,
       is_active !== undefined ? is_active : null, req.params.id]
    );
    await auditLog(client, req.user.id, 'update_role', 'role', parseInt(req.params.id),
      { before: { name: existing.name }, after: { name: updated.name } }, req);
    await client.query('COMMIT');

    // Real-Time Sync Engine: Emit event
    dispatchEvent('role.updated', { role_id: updated.id, name: updated.name }, 'room:admin').catch(e => logger.error('dispatchEvent failed', { error: e.message, stack: e.stack }));

    res.json({ data: updated });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ── DELETE /roles/:id ─────────────────────────────────────── */
router.delete('/:id', authenticate, authorize('admin'), requireRoleAuthority('id'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    const { rows: [role] } = await client.query('SELECT * FROM roles WHERE id = $1', [req.params.id]);
    if (!role) return res.status(404).json({ error: 'Role not found' });
    if (role.is_system) return res.status(409).json({ error: 'System roles cannot be deleted' });

    const { rows: [userCount] } = await client.query(
      'SELECT COUNT(*) AS cnt FROM user_roles WHERE role_id = $1', [req.params.id]
    );
    if (parseInt(userCount.cnt) > 0) return res.status(409).json({
      error: `Cannot delete role "${role.name}" — ${userCount.cnt} user(s) are assigned to it. Remove assignments first.`
    });

    await client.query('BEGIN');
    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [req.params.id]);
    await client.query('DELETE FROM roles WHERE id = $1', [req.params.id]);
    await auditLog(client, req.user.id, 'delete_role', 'role', parseInt(req.params.id),
      { name: role.name, slug: role.slug }, req);
    await client.query('COMMIT');

    logger.info('Role deleted', { roleId: req.params.id, name: role.name });
    
    // Real-Time Sync Engine: Emit event
    dispatchEvent('role.deleted', { role_id: parseInt(req.params.id), name: role.name }, 'room:admin').catch(e => logger.error('dispatchEvent failed', { error: e.message, stack: e.stack }));

    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ── POST /roles/:id/clone ─────────────────────────────────── */
router.post('/:id/clone', authenticate, authorize('admin'), requireRoleAuthority('id'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    const { rows: [source] } = await client.query('SELECT * FROM roles WHERE id = $1', [req.params.id]);
    if (!source) return res.status(404).json({ error: 'Source role not found' });

    const newSlug = `${source.slug}_clone_${Date.now()}`;
    const newName = `${source.name} (Clone)`;

    await client.query('BEGIN');
    const { rows: [clone] } = await client.query(
      `INSERT INTO roles (name, slug, description, is_system) VALUES ($1, $2, $3, FALSE) RETURNING *`,
      [newName, newSlug, source.description ? `${source.description} (cloned from ${source.name})` : null]
    );
    const { rows: perms } = await client.query(
      'SELECT module, submodule, permissions FROM role_permissions WHERE role_id = $1',
      [req.params.id]
    );
    for (const p of perms) {
      await client.query(
        `INSERT INTO role_permissions (role_id, module, submodule, permissions)
         VALUES ($1, $2, $3, $4)`,
        [clone.id, p.module, p.submodule, p.permissions]
      );
    }
    await auditLog(client, req.user.id, 'clone_role', 'role', clone.id,
      { sourceRoleId: source.id, sourceName: source.name }, req);
    await client.query('COMMIT');

    res.status(201).json({ data: clone });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ════════════════════════════════════════════════════════════════
   PERMISSIONS
   ════════════════════════════════════════════════════════════════ */

/* ── GET /roles/:id/permissions ────────────────────────────── */
router.get('/:id/permissions', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rows: [role] } = await pool.query('SELECT * FROM roles WHERE id = $1', [req.params.id]);
    if (!role) return res.status(404).json({ error: 'Role not found' });

    const { rows: perms } = await pool.query(
      'SELECT module, submodule, permissions FROM role_permissions WHERE role_id = $1',
      [req.params.id]
    );
    const permMap = {};
    perms.forEach(p => {
      permMap[`${p.module}:${p.submodule}`] = p.permissions;
    });

    const tree = MODULE_TREE.map(m => ({
      ...m,
      submodules: m.submodules.map(sm => {
        const key = `${m.module}:${sm.key}`;
        return {
          key: sm.key,
          label: sm.label,
          permissions: permMap[key] !== undefined ? permMap[key] : (role.slug === 'admin' ? FULL_ACCESS : 0),
        };
      }),
    }));
    res.json({ data: tree });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── PUT /roles/:id/permissions ────────────────────────────── */
router.put('/:id/permissions', authenticate, authorize('admin'), requireRoleAuthority('id'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    const { rows: [role] } = await client.query('SELECT * FROM roles WHERE id = $1', [req.params.id]);
    if (!role) return res.status(404).json({ error: 'Role not found' });

    const { permissions } = req.body; // array of { module, submodule, permissions (bitmask) }
    if (!Array.isArray(permissions)) return res.status(400).json({ error: 'permissions array required' });

    await client.query('BEGIN');

    // Capture old state for audit
    const { rows: oldPerms } = await client.query(
      'SELECT module, submodule, permissions FROM role_permissions WHERE role_id = $1',
      [req.params.id]
    );

    // Replace all permissions for this role
    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [req.params.id]);
    for (const p of permissions) {
      await client.query(
        `INSERT INTO role_permissions (role_id, module, submodule, permissions)
         VALUES ($1, $2, $3, $4)`,
        [parseInt(req.params.id), p.module, p.submodule, p.permissions || 0]
      );
    }

    await auditLog(client, req.user.id, 'update_permissions', 'role', parseInt(req.params.id),
      { roleName: role.name, before: oldPerms, after: permissions }, req);
    await client.query('COMMIT');

    logger.info('Permissions updated', { roleId: req.params.id, roleName: role.name, userId: req.user.id });
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ════════════════════════════════════════════════════════════════
   USER-ROLE ASSIGNMENTS
   ════════════════════════════════════════════════════════════════ */

/* ── GET /users/:id/roles ──────────────────────────────────── */
router.get('/users/:id/roles', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ur.role_id AS id, r.name, r.slug, ur.assigned_at
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1`,
      [req.params.id]
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── PUT /users/:id/roles ──────────────────────────────────── */
router.put('/users/:id/roles', authenticate, authorize('admin'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    const { role_ids } = req.body; // array of role IDs
    if (!Array.isArray(role_ids)) return res.status(400).json({ error: 'role_ids array required' });

    await client.query('BEGIN');

    // Get old roles for audit
    const { rows: oldRoles } = await client.query(
      'SELECT role_id FROM user_roles WHERE user_id = $1',
      [req.params.id]
    );

    const oldIds = oldRoles.map(r => r.role_id).sort((a,b) => a - b);
    const newIds = [...role_ids].sort((a,b) => a - b);
    const changed = oldIds.length !== newIds.length || oldIds.some((v, i) => v !== newIds[i]);

    if (changed) {
      // Replace all roles
      await client.query('DELETE FROM user_roles WHERE user_id = $1', [req.params.id]);
      for (const roleId of role_ids) {
        await client.query(
          'INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3)',
          [req.params.id, roleId, req.user.id]
        );
      }

      await auditLog(client, req.user.id, 'assign_roles', 'user', parseInt(req.params.id),
        { before: oldRoles.map(r => r.role_id), after: role_ids }, req);
    }

    await client.query('COMMIT');

    logger.info('User roles updated', { userId: req.params.id, roles: role_ids });
    
    // Real-Time Sync Engine: Emit targeted event for cache invalidation (permission.changed already handles the targeted user)
    dispatchEvent('role.assigned', { user_id: parseInt(req.params.id), roles: role_ids }, 'room:admin').catch(e => logger.error('dispatchEvent failed', { error: e.message, stack: e.stack }));

    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

/* ════════════════════════════════════════════════════════════════
   MODULE TREE (for frontend)
   ════════════════════════════════════════════════════════════════ */

/* ── GET /modules ──────────────────────────────────────────── */
router.get('/modules', authenticate, authorize('admin'), async (req, res) => {
  res.json({ data: MODULE_TREE });
});

/* ════════════════════════════════════════════════════════════════
   AUDIT LOG
   ════════════════════════════════════════════════════════════════ */

/* ── GET /audit-log ───────────────────────────────────────────── */
router.get('/audit-log', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { page = 1, pageSize = 50, target_type, action } = req.query;
    const limit = Math.min(parseInt(pageSize) || 50, 200);
    const offset = (Math.max(parseInt(page), 1) - 1) * limit;

    let where = 'WHERE 1=1';
    const params = [];
    let idx = 0;

    if (target_type) { idx++; where += ` AND al.target_type = $${idx}`; params.push(target_type); }
    if (action) { idx++; where += ` AND al.action = $${idx}`; params.push(action); }
    if (req.query.user_id) { 
      idx++; 
      where += ` AND (al.user_id = $${idx} OR (al.target_type = 'user' AND al.target_id = $${idx}))`; 
      params.push(req.query.user_id); 
    }

    idx++; const limitP = idx;
    idx++; const offsetP = idx;

    const countR = await pool.query(
      `SELECT COUNT(*) FROM permission_audit_logs al ${where}`, params
    );
    const { rows } = await pool.query(
      `SELECT al.*, u.full_name AS user_name, u.username, u.role
       FROM permission_audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${limitP} OFFSET $${offsetP}`,
      [...params, limit, offset]
    );

    res.json({
      data: rows,
      total: parseInt(countR.rows[0].count),
      page: parseInt(page),
      pageSize: limit,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── GET /users-with-roles ─────────────────────────────────── */
router.get('/users-with-roles', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.role AS legacy_role, u.is_active,
              COALESCE(
                json_agg(
                  json_build_object('role_id', r.id, 'role_name', r.name, 'role_slug', r.slug)
                ) FILTER (WHERE r.id IS NOT NULL),
                '[]'
              ) AS roles,
              d.name AS department_name
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       LEFT JOIN departments d ON d.id = u.department_id
       GROUP BY u.id, u.username, u.full_name, u.email, u.role, u.is_active, d.name
       ORDER BY u.full_name ASC`
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
