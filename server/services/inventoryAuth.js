/**
 * Inventory Authorization Service
 *
 * Single-responsibility: builds per-request authorization context for all
 * Inventory module routes. Zero I/O after first call per request — the
 * resolved context is attached to req.inventoryAuth and reused.
 *
 * Responsibilities
 * ─────────────────
 * 1. canViewInventory   — user has VIEW bit on the 'inventory' module.
 * 2. canExport          — user has EXPORT bit on the 'inventory' module.
 * 3. canViewFinancial   — user's roles include the 'inventory_financial'
 *                         submodule permission (VIEW bit), OR the user is
 *                         super_admin/admin. Absent → financial keys stripped.
 * 4. scopeMode          — 'ALL' | 'SELECTED' | 'NONE' from
 *                         user_inventory_scopes (defaults to 'ALL').
 * 5. allowedDeptIds     — dept IDs from user_inventory_scope_depts
 *                         (only meaningful for SELECTED mode).
 * 6. includeUnassigned  — whether lots with no department pass through.
 *
 * Financial fields stripped when canViewFinancial is false
 * ─────────────────────────────────────────────────────────
 * rate, unit_rate, purchase_rate, sale_rate, avg_rate,
 * cost, unit_cost, total_cost, total_value, inventory_value,
 * valuation, cogs, profit, margin, markup,
 * book_value, opening_value, closing_value
 *
 * Security contract
 * ──────────────────
 * Fields are ABSENT from serialized responses, never null/zero.
 * Scope 'NONE' returns zero rows — not a 403 — to avoid enumeration.
 * Direct-ID routes (GET /:id) return 404 for out-of-scope lots.
 * super_admin bypasses all checks (existing behaviour preserved).
 */

'use strict';

const pool = require('../db/pool');
const { getUserPermissionBitmask, PERM_BITS } = require('../utils/permissions');

// ── Financial field list (exhaustive) ────────────────────────────────────────
const FINANCIAL_FIELDS = Object.freeze([
  'rate', 'unit_rate', 'purchase_rate', 'sale_rate', 'avg_rate',
  'cost', 'unit_cost', 'total_cost', 'total_value', 'inventory_value',
  'valuation', 'cogs', 'profit', 'margin', 'markup',
  'book_value', 'opening_value', 'closing_value',
]);

// ── Roles that always see financial fields ────────────────────────────────────
const FINANCIAL_BYPASS_ROLES = Object.freeze(['super_admin', 'admin']);

// ── canViewFinancial: does user have VIEW on 'inventory' / 'inventory_financial'?
async function resolveCanViewFinancial(userId, userRole) {
  if (FINANCIAL_BYPASS_ROLES.includes(userRole)) return true;
  // Check submodule-level financial permission
  const mask = await getUserPermissionBitmask(userId, 'inventory', 'inventory_financial');
  if ((mask & PERM_BITS.view) === PERM_BITS.view) return true;
  return false;
}

// ── Load full authorization context for one request ──────────────────────────
async function loadInventoryAuthContext(userId, userRole) {
  // 1. Module-level permission bitmask
  const invMask = await getUserPermissionBitmask(userId, 'inventory', '');

  const canViewInventory = FINANCIAL_BYPASS_ROLES.includes(userRole) ||
                           (invMask & PERM_BITS.view) === PERM_BITS.view;
  const canExport        = FINANCIAL_BYPASS_ROLES.includes(userRole) ||
                           (invMask & PERM_BITS.export) === PERM_BITS.export;

  // 2. Financial field access
  const canViewFinancial = await resolveCanViewFinancial(userId, userRole);

  // 3. Department scope
  let scopeMode         = 'ALL';
  let includeUnassigned = false;
  let allowedDeptIds    = [];

  try {
    const scopeRow = await pool.query(
      'SELECT scope_mode, include_unassigned FROM user_inventory_scopes WHERE user_id = $1',
      [userId]
    );
    if (scopeRow.rows.length > 0) {
      scopeMode         = scopeRow.rows[0].scope_mode;
      includeUnassigned = scopeRow.rows[0].include_unassigned;
    }

    if (scopeMode === 'SELECTED') {
      const deptRows = await pool.query(
        'SELECT department_id FROM user_inventory_scope_depts WHERE user_id = $1',
        [userId]
      );
      allowedDeptIds = deptRows.rows.map(r => r.department_id);
    }
  } catch (err) {
    // Tables may not exist on first deploy before migration — degrade to ALL
    if (err.code !== '42P01') throw err;
    scopeMode = 'ALL';
  }

  return {
    canViewInventory,
    canExport,
    canViewFinancial,
    scopeMode,
    allowedDeptIds,
    includeUnassigned,
  };
}

// ── Express middleware: load context, attach to req, enforce view gate ────────
async function requireInventoryView(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });

  // super_admin: full bypass — no DB queries needed
  if (req.user.role === 'super_admin') {
    req.inventoryAuth = {
      canViewInventory:  true,
      canExport:         true,
      canViewFinancial:  true,
      scopeMode:         'ALL',
      allowedDeptIds:    [],
      includeUnassigned: false,
    };
    return next();
  }

  try {
    const ctx = await loadInventoryAuthContext(req.user.id, req.user.role);
    req.inventoryAuth = ctx;

    if (!ctx.canViewInventory) {
      return res.status(403).json({ error: 'Permission denied: inventory.view' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: 'Authorization error' });
  }
}

// ── Strip financial fields from a single row object ──────────────────────────
function stripFinancialRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const key of FINANCIAL_FIELDS) delete out[key];
  return out;
}

// ── Strip financial fields from row or array of rows ─────────────────────────
function stripFinancial(rowOrArray, canViewFinancial) {
  if (canViewFinancial) return rowOrArray;
  if (Array.isArray(rowOrArray)) return rowOrArray.map(stripFinancialRow);
  return stripFinancialRow(rowOrArray);
}

// ── Build dept scope WHERE clause fragment ────────────────────────────────────
// Returns { clause: string, params: [] } where params is a copy of the input
// params array with any new param appended.
//
// The generated clause uses inv.department_id — callers must alias the
// inventory table as 'inv' (as the existing inventory.js routes do).
function buildDeptScopeClause(ctx, params) {
  const { scopeMode, allowedDeptIds, includeUnassigned } = ctx;

  if (scopeMode === 'ALL') {
    return { clause: '', params };
  }

  if (scopeMode === 'NONE') {
    return { clause: ' AND 1=0', params };
  }

  // SELECTED
  if (!allowedDeptIds || allowedDeptIds.length === 0) {
    // No departments whitelisted → return nothing (treat as NONE)
    return { clause: ' AND 1=0', params };
  }

  const newParams = [...params];
  newParams.push(allowedDeptIds);
  const pIdx = newParams.length;

  let clause = ` AND (inv.department_id = ANY($${pIdx}::int[])`;
  if (includeUnassigned) {
    clause += ' OR inv.department_id IS NULL';
  }
  clause += ')';

  return { clause, params: newParams };
}

// ── Check if a single lot row is within the caller's dept scope ───────────────
// Used by direct-ID routes (GET /:id) which cannot pre-filter via SQL.
function isLotInScope(ctx, lotRow) {
  if (ctx.scopeMode === 'ALL') return true;
  if (ctx.scopeMode === 'NONE') return false;

  // SELECTED
  const lotDeptId = lotRow.department_id != null ? parseInt(lotRow.department_id) : null;
  if (lotDeptId === null) return ctx.includeUnassigned;
  return ctx.allowedDeptIds.includes(lotDeptId);
}

module.exports = {
  FINANCIAL_FIELDS,
  loadInventoryAuthContext,
  requireInventoryView,
  stripFinancial,
  buildDeptScopeClause,
  isLotInScope,
};
