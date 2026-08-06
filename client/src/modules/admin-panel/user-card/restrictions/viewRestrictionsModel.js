/**
 * RBAC Brick 4 — pure model for the compact View Restrictions panel.
 *
 * PURE FUNCTIONS ONLY. No React, no network, no writes.
 *
 * WHAT THIS FILE IS NOT
 *   - It is not a restriction registry. Labels, descriptions, storage strings and
 *     enforcement references come from the Brick 1 catalog payload
 *     (GET /api/admin/permission-catalog → `view_restrictions`). Nothing here
 *     re-declares that metadata; when the catalog is missing the row degrades to
 *     a humanised key and an UNKNOWN status rather than an invented label.
 *   - It is not a second dirty-state engine. Scope comparison delegates to
 *     `canonicalScope` from userCardModel, which is the Brick 2 comparison the
 *     save path already uses.
 *   - It is not a second permission resolver. The Financial Fields verdict is
 *     produced by Brick 3's `baselineStateFor` / `overrideStateFor` /
 *     `effectiveFor`, which are themselves the server resolver's precedence.
 *
 * THE DOWNGRADE-ONLY RULE
 * Two role lists below are copied from server/services/inventoryAuth.js. They are
 * used for exactly one purpose: to WEAKEN a security claim the catalog makes, and
 * never to strengthen one. A stale copy can therefore only ever under-promise.
 * See resolveScopeStatus / financialBypassFor.
 */

import { PERM_BITS } from '../../../../shared/constants/permissions';
import { canonicalScope, overrideKey } from '../userCardModel';
import {
  BASELINE,
  EFFECT,
  SOURCE,
  baselineStateFor,
  overrideStateFor,
  effectiveFor,
  describeSource,
} from '../permissions/permissionEditorModel';

/* ── Status vocabulary ──────────────────────────────────────── */

/**
 * Never collapsed into "Active" or "Secure": the whole point of the panel is that
 * a stored value and an enforced control are different things.
 */
export const RESTRICTION_STATUS = {
  ENFORCED: 'ENFORCED',
  PARTIALLY_ENFORCED: 'PARTIALLY_ENFORCED',
  PERMISSION_CONTROLLED: 'PERMISSION_CONTROLLED',
  STORED_NOT_ENFORCED: 'STORED_NOT_ENFORCED',
  PLANNED_INACTIVE: 'PLANNED_INACTIVE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  UNKNOWN: 'UNKNOWN',
};

export const RESTRICTION_STATUS_LABELS = {
  ENFORCED: 'Enforced',
  PARTIALLY_ENFORCED: 'Partially enforced',
  PERMISSION_CONTROLLED: 'Permission controlled',
  STORED_NOT_ENFORCED: 'Not enforced',
  PLANNED_INACTIVE: 'Inactive',
  NOT_APPLICABLE: 'Not applicable',
  UNKNOWN: 'Unverified',
};

/** Statuses that may be presented as a live security control. */
const SECURE_STATUSES = [
  RESTRICTION_STATUS.ENFORCED,
  RESTRICTION_STATUS.PARTIALLY_ENFORCED,
  RESTRICTION_STATUS.PERMISSION_CONTROLLED,
];

export function isSecurityControl(status) {
  return SECURE_STATUSES.includes(status);
}

export const RESTRICTION_GROUP = {
  ENFORCED: 'Active and enforced',
  PERMISSION: 'Permission controlled',
  STORED: 'Stored but not enforced',
  DIAGNOSTIC: 'Inactive diagnostics',
};

export const CATALOG_UNAVAILABLE_NOTICE =
  'View restriction diagnostics unavailable. Existing inventory scope controls remain available.';

export const STORED_NOT_ENFORCED_DESC = 'Stored setting — backend enforcement not implemented';

/* ── Verified backend role behaviour (downgrade-only) ───────── */

/**
 * server/services/inventoryAuth.js:225 SUPER_ADMIN_ROLES — bypass every scope in
 * loadDeptScope (lot movements, stock transfer, search) AND in requireInventoryView.
 */
export const SCOPE_BYPASS_ROLES = Object.freeze(['super_admin', 'superadmin', 'super admin']);

/**
 * server/services/inventoryAuth.js:51 FINANCIAL_BYPASS_ROLES — always see financial
 * fields, and requireInventoryView (server/services/inventoryAuth.js:127) additionally
 * forces scopeMode 'ALL' for them on the /api/inventory routes only. loadDeptScope
 * does NOT extend that bypass, so their stored department scope still applies on
 * lot movements, stock transfer and search: partial, not absent.
 */
export const FINANCIAL_BYPASS_ROLES = Object.freeze([
  'super_admin', 'superadmin', 'super admin', 'admin', 'administrator',
  'management', 'manager', 'owner', 'developer',
]);

/** server/services/inventoryAuth.js:81 — the only role whose default scope is NONE. */
export const RESTRICTED_OPERATOR_ROLE = 'operator_restricted';

const normaliseRole = role => String(role || '').toLowerCase().trim();

export function isScopeBypassRole(role) {
  return SCOPE_BYPASS_ROLES.includes(normaliseRole(role));
}

export function financialBypassFor(role) {
  return FINANCIAL_BYPASS_ROLES.includes(normaliseRole(role));
}

/* ── Catalog access ─────────────────────────────────────────── */

export const SCOPE_RESTRICTION_CODE = 'scope.inventory_department';
export const FINANCIAL_RESTRICTION_CODE = 'inventory.inventory_financial';
export const FINANCIAL_STORAGE_KEY = overrideKey('inventory', 'inventory_financial');

/** The `view_restrictions` array, or null when the catalog did not supply one. */
export function viewRestrictionsOf(catalog) {
  const list = catalog?.view_restrictions;
  return Array.isArray(list) && list.length > 0 ? list : null;
}

export function restrictionMetaOf(catalog, code) {
  return viewRestrictionsOf(catalog)?.find(entry => entry?.code === code) || null;
}

/** The permission catalog entry backing a capability, for `has_baseline_rows`. */
export function permissionEntryOf(catalog, code) {
  const list = catalog?.permissions;
  return (Array.isArray(list) ? list : []).find(entry => entry?.code === code) || null;
}

/**
 * `vis.show_gross_profit` → `Gross Profit`. Used ONLY when the catalog carries no
 * label, so a diagnostic outage degrades the wording and never the honesty of the
 * row. Deliberately not a lookup table — a table here would be the duplicate
 * registry Brick 4 must not create.
 */
export function humaniseVisKey(key) {
  return String(key || '')
    .replace(/^vis\./, '')
    .replace(/^show_/, '')
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/* ── Inventory department scope ─────────────────────────────── */

export const SCOPE_MODE = { NONE: 'NONE', SELECTED: 'SELECTED', ALL: 'ALL' };

export const SCOPE_MODE_OPTIONS = Object.freeze([
  { value: SCOPE_MODE.NONE, label: 'No Access' },
  { value: SCOPE_MODE.SELECTED, label: 'Selected Departments' },
  { value: SCOPE_MODE.ALL, label: 'All Departments' },
]);

export const SCOPE_SUMMARY_NAME_LIMIT = 2;

/**
 * Selected department names in the department list's own order, so a reorder of
 * `department_ids` can never change the summary text.
 */
export function selectedDepartmentNames(scope, departments) {
  const ids = new Set((scope?.department_ids || []).map(Number));
  return (departments || [])
    .filter(dept => ids.has(Number(dept.id)))
    .map(dept => dept.name);
}

/**
 * The compact one-line value shown on the summary row.
 *   NONE      → 'No inventory departments'
 *   ALL       → 'All inventory departments'
 *   SELECTED  → 'Growing, Polish 2' / 'Growing, Polish 2 +3 more' / the empty case
 */
export function summariseScope(scope, departments, limit = SCOPE_SUMMARY_NAME_LIMIT) {
  const mode = scope?.scope_mode || SCOPE_MODE.ALL;
  if (mode === SCOPE_MODE.NONE) return 'No inventory departments';
  if (mode === SCOPE_MODE.ALL) return 'All inventory departments';

  const names = selectedDepartmentNames(scope, departments);
  const unresolved = (scope?.department_ids || []).length - names.length;
  if (names.length === 0) {
    return unresolved > 0
      ? `${unresolved} selected department${unresolved === 1 ? '' : 's'}`
      : 'No departments selected';
  }

  const shown = names.slice(0, limit).join(', ');
  const remaining = Math.max(names.length - limit, 0) + Math.max(unresolved, 0);
  return remaining > 0 ? `${shown} +${remaining} more` : shown;
}

/** Snapshot-free equality, delegated to the Brick 2 canonical form. */
export function scopesEqual(a, b) {
  return canonicalScope(a) === canonicalScope(b);
}

/**
 * SELECTED with an empty whitelist. The API rejects it with 400
 * (adminUsers.js:217) and buildDeptScopeClause fails closed to NONE, so the
 * dialog warns rather than silently producing a save the admin cannot complete.
 */
export function isEmptySelection(scope) {
  return scope?.scope_mode === SCOPE_MODE.SELECTED
    && (scope?.department_ids || []).length === 0;
}

/* ── Dialog draft transitions (pure) ────────────────────────── */

/**
 * Mode changes reproduce the pre-Brick-4 editor exactly: leaving SELECTED clears
 * the whitelist, because that is what PUT /inventory-scope stores. Entering
 * SELECTED keeps whatever the draft already held, so a mis-click is recoverable.
 */
export function setScopeMode(draft, mode) {
  return {
    scope_mode: mode,
    department_ids: mode === SCOPE_MODE.SELECTED ? [...(draft?.department_ids || [])] : [],
  };
}

export function toggleDepartment(draft, id) {
  const ids = draft?.department_ids || [];
  const has = ids.some(value => Number(value) === Number(id));
  return {
    ...draft,
    department_ids: has
      ? ids.filter(value => Number(value) !== Number(id))
      : [...ids, id],
  };
}

/** Adds the currently visible departments without disturbing off-screen picks. */
export function selectDepartments(draft, ids) {
  const merged = [...(draft?.department_ids || [])];
  for (const id of ids || []) {
    if (!merged.some(value => Number(value) === Number(id))) merged.push(id);
  }
  return { ...draft, department_ids: merged };
}

export function clearDepartments(draft) {
  return { ...draft, department_ids: [] };
}

export function filterDepartments(departments, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (needle === '') return departments || [];
  return (departments || []).filter(
    dept => String(dept.name || '').toLowerCase().includes(needle),
  );
}

/* ── Row status resolution ──────────────────────────────────── */

/**
 * Inventory Department Access, as it behaves FOR THIS USER.
 *
 * The catalog's ENFORCED claim is the ceiling, never the floor: an absent catalog
 * gives UNKNOWN, and a bypassing role downgrades from there. Nothing in this
 * function can raise a status.
 */
export function resolveScopeStatus({ catalog, role }) {
  const meta = restrictionMetaOf(catalog, SCOPE_RESTRICTION_CODE);
  const catalogStatus = meta?.status === 'ENFORCED'
    ? RESTRICTION_STATUS.ENFORCED
    : RESTRICTION_STATUS.UNKNOWN;

  if (isScopeBypassRole(role)) {
    return {
      status: RESTRICTION_STATUS.NOT_APPLICABLE,
      meta,
      warning: 'Super Admin bypasses inventory department scope entirely. The stored '
        + 'value is kept but has no effect for this role.',
    };
  }

  if (financialBypassFor(role)) {
    return {
      status: RESTRICTION_STATUS.PARTIALLY_ENFORCED,
      meta,
      warning: `The inventory API grants the "${role}" role full inventory access `
        + '(inventoryAuth.js:127), so this scope does not restrict /api/inventory. It is '
        + 'still applied to Lot Movements, Stock Transfer and Search.',
    };
  }

  if (normaliseRole(role) === RESTRICTED_OPERATOR_ROLE) {
    return {
      status: catalogStatus,
      meta,
      warning: 'When no scope row is stored, the inventory API defaults this role to NONE '
        + '(inventoryAuth.js:81) while the admin API reports ALL. Save an explicit mode to '
        + 'remove the ambiguity.',
    };
  }

  return { status: catalogStatus, meta, warning: null };
}

/**
 * Financial Fields, derived from the existing effective-permission result.
 *
 * No control is offered here and no mask is read that Brick 3 does not already
 * read: this row reports, and its action navigates to the capability in the
 * grouped editor.
 */
export function resolveFinancialRow({ catalog, overrides, baseline, role, isSuperAdmin }) {
  const meta = restrictionMetaOf(catalog, FINANCIAL_RESTRICTION_CODE);
  const entry = permissionEntryOf(catalog, FINANCIAL_RESTRICTION_CODE);
  const bit = PERM_BITS.view;

  // `has_baseline_rows` is a Brick 1 verification. Without the catalog we cannot
  // claim there is no row, so the baseline reads as UNKNOWN instead of NO_ROW.
  const capability = {
    storageKey: FINANCIAL_STORAGE_KEY,
    hasBaselineRow: entry ? entry.has_baseline_rows !== false : true,
  };

  const baselineState = entry
    ? baselineStateFor(capability, bit, baseline)
    : BASELINE.UNKNOWN;
  const overrideState = overrideStateFor(overrides, FINANCIAL_STORAGE_KEY, bit);
  const { effect, source } = effectiveFor({ baselineState, overrideState, isSuperAdmin });

  const bypass = !isSuperAdmin && financialBypassFor(role);

  return {
    meta,
    code: FINANCIAL_RESTRICTION_CODE,
    label: meta?.label || 'Financial Fields',
    storageKey: FINANCIAL_STORAGE_KEY,
    baselineState,
    overrideState,
    effect,
    source,
    sourceText: describeSource(source, baseline?.roleNames),
    /** The row's headline value, in the language of visibility rather than masks. */
    summary: effect === EFFECT.ALLOWED
      ? 'Visible'
      : effect === EFFECT.DENIED ? 'Hidden' : 'Unverified',
    status: RESTRICTION_STATUS.PERMISSION_CONTROLLED,
    bypass,
    warning: bypass
      ? `The inventory API returns financial fields to the "${role}" role regardless of `
        + 'this permission (inventoryAuth.js:51). Removing the permission will not hide them.'
      : null,
  };
}

/* ── Stored-but-unenforced preference rows ──────────────────── */

/**
 * One row per `vis.*` key THAT ALREADY EXISTS in the loaded preferences.
 *
 * Discovery is from the user's own preference values, not from a key list: a key
 * the account does not hold must not appear as an editable-looking row, because
 * rendering it is the first step towards initialising it.
 */
export function buildStoredRows({ prefs, catalog }) {
  return Object.keys(prefs || {})
    .filter(key => key.startsWith('vis.'))
    .map((key) => {
      const meta = restrictionMetaOf(catalog, key);
      const raw = prefs[key];
      const on = raw === true || raw === 'true';
      return {
        code: key,
        label: meta?.label || humaniseVisKey(key),
        summary: on ? 'Visible' : 'Hidden',
        storedValue: String(raw ?? ''),
        status: RESTRICTION_STATUS.STORED_NOT_ENFORCED,
        description: STORED_NOT_ENFORCED_DESC,
        meta,
        warning: meta?.warning || null,
      };
    });
}

/**
 * Catalog view-restriction entries with no stored value and no row of their own —
 * Super Admin diagnostics only, read-only, and explicitly NOT initialised.
 */
export function buildDiagnosticRows({ prefs, catalog }) {
  const restrictions = viewRestrictionsOf(catalog);
  if (!restrictions) return [];
  const stored = new Set(Object.keys(prefs || {}));

  return restrictions
    .filter(entry => entry.code !== SCOPE_RESTRICTION_CODE
      && entry.code !== FINANCIAL_RESTRICTION_CODE
      && !stored.has(entry.code))
    .map(entry => ({
      code: entry.code,
      label: entry.label || humaniseVisKey(entry.code),
      summary: 'No stored value',
      storedValue: null,
      status: RESTRICTION_STATUS.PLANNED_INACTIVE,
      description: 'Inactive — not granted to any standard role',
      meta: entry,
      warning: entry.warning || null,
    }));
}

/* ── Whole-panel derivation ─────────────────────────────────── */

/**
 * The panel as plain data. `catalogAvailable` drives the honest fallback notice
 * instead of silently degrading the statuses without saying so.
 */
export function buildRestrictionsView({
  catalog, catalogFailed, prefs, overrides, baseline, role, isSuperAdmin,
  inventoryScope, departments,
}) {
  const catalogAvailable = !catalogFailed && viewRestrictionsOf(catalog) !== null;
  const scope = resolveScopeStatus({ catalog, role });
  const financial = resolveFinancialRow({ catalog, overrides, baseline, role, isSuperAdmin });
  const stored = buildStoredRows({ prefs, catalog });
  const diagnostics = isSuperAdmin ? buildDiagnosticRows({ prefs, catalog }) : [];

  return {
    catalogAvailable,
    scope: {
      code: SCOPE_RESTRICTION_CODE,
      label: scope.meta?.label || 'Inventory Departments',
      summary: summariseScope(inventoryScope, departments),
      status: scope.status,
      meta: scope.meta,
      warning: scope.warning,
      emptySelection: isEmptySelection(inventoryScope),
      /** Super Admin has no scope to edit — the resolver ignores it. */
      editable: !isScopeBypassRole(role),
    },
    financial,
    stored,
    diagnostics,
    counts: {
      stored: stored.length,
      diagnostics: diagnostics.length,
    },
  };
}

/* Re-exported so components never reach past this model into Brick 3. */
export { EFFECT, SOURCE, BASELINE };
