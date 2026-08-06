/**
 * RBAC Brick 3 — the Brick 1 catalog turned into editor-ready capabilities.
 *
 * The server catalog (GET /api/admin/permission-catalog) is the ONLY source of
 * grouping, labels, lifecycle status, applicable actions, risk and enforcement.
 * Nothing here re-declares that data: there is no second client-side catalog and
 * there never may be one, because a drifting copy is how the previous editor
 * lost `override_weight_variance`.
 *
 * Action BITS are the one thing the catalog does not carry, so they still come
 * from shared/constants/permissions. permissionEditorModel.test.js pins those
 * values against server/utils/permissions.js, which is what makes reusing the
 * client map safe instead of introducing a second bit table.
 *
 * Storage keys are never invented here either: `storageKey` is built from the
 * entry's real `backend_module` / `backend_submodule`, so what the editor writes
 * is byte-identical to what the resolver reads. `canonical_code` is presentation
 * only and is deliberately NOT used to pick a key.
 */

import { PERM_BITS, ACTIONS } from '../../../../shared/constants/permissions';
import { overrideKey } from '../userCardModel';

const ACTION_LABELS = new Map(ACTIONS.map(a => [a.id, a.label]));
/** Canonical action display order — a capability shows a subset, never a reorder. */
const ACTION_ORDER = ACTIONS.map(a => a.id);

/* ── Lifecycle ──────────────────────────────────────────────── */

export const STATUS = {
  ACTIVE: 'ACTIVE',
  PLANNED_INACTIVE: 'PLANNED_INACTIVE',
  DUPLICATE_LEGACY: 'DUPLICATE_LEGACY',
  LEGACY_ORPHAN: 'LEGACY_ORPHAN',
};

export const STATUS_LABELS = {
  ACTIVE: 'Active',
  PLANNED_INACTIVE: 'Planned — no active feature',
  DUPLICATE_LEGACY: 'Duplicate legacy key',
  LEGACY_ORPHAN: 'Legacy orphan',
};

/**
 * Why an entry is read-only. Rendered verbatim, so it must stay honest: these
 * rows keep whatever masks they already hold, they are simply not editable as
 * live settings.
 */
export const STATUS_NOTE = {
  PLANNED_INACTIVE:
    'No active feature reads this permission yet. Existing values are preserved and shown read-only.',
  DUPLICATE_LEGACY:
    'A second stored key for a capability owned by another entry. Existing values are preserved; edit the canonical capability instead.',
  LEGACY_ORPHAN:
    'The feature this key guarded is gone or was re-keyed. Existing values are preserved and shown read-only.',
};

/* ── Enforcement ────────────────────────────────────────────── */

export const ENFORCEMENT_LEVEL = {
  ENFORCED: 'ENFORCED',
  PARTIAL: 'PARTIAL',
  NOT_ENFORCED: 'NOT_ENFORCED',
  NO_ACTIVE_FEATURE: 'NO_ACTIVE_FEATURE',
};

export const ENFORCEMENT_LABELS = {
  ENFORCED: 'Enforced',
  PARTIAL: 'Partial',
  NOT_ENFORCED: 'Not enforced',
  NO_ACTIVE_FEATURE: 'No active feature',
};

export const ENFORCEMENT_WARNING =
  'Permission configuration and backend enforcement coverage are separate. '
  + 'Backend enforcement closure is scheduled for RBAC Brick 8.';

/**
 * Collapses the eleven per-surface classifications into one compact badge —
 * without ever collapsing them into a misleading "Secure". Anything short of
 * "every present surface is ENFORCED" reads as Partial or Not enforced, and the
 * full per-surface breakdown stays available to the details panel.
 */
export function enforcementLevelOf(enforcement) {
  const statuses = Object.values(enforcement || {}).filter(s => s !== 'NO_ACTIVE_FEATURE');
  if (statuses.length === 0) return ENFORCEMENT_LEVEL.NO_ACTIVE_FEATURE;
  if (statuses.every(s => s === 'ENFORCED')) return ENFORCEMENT_LEVEL.ENFORCED;
  if (statuses.some(s => s === 'ENFORCED' || s === 'PARTIALLY_ENFORCED')) {
    return ENFORCEMENT_LEVEL.PARTIAL;
  }
  return ENFORCEMENT_LEVEL.NOT_ENFORCED;
}

/* ── Validation ─────────────────────────────────────────────── */

function invalid(reason) {
  return { ok: false, reason };
}

/**
 * Everything the grouped editor assumes about the catalog, checked before a
 * single row is rendered. A failure here is not fatal: the caller falls back to
 * the legacy matrix, so user administration continues. The reason string is
 * surfaced to the admin rather than swallowed.
 */
export function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object') return invalid('no catalog was returned');
  if (!Array.isArray(catalog.permissions) || catalog.permissions.length === 0) {
    return invalid('the catalog contains no permission entries');
  }
  if (catalog.groups !== undefined && !Array.isArray(catalog.groups)) {
    return invalid('the catalog group list is malformed');
  }

  const codes = new Set();
  const storageKeys = new Set();
  let activeCount = 0;

  for (const entry of catalog.permissions) {
    if (!entry || typeof entry.code !== 'string' || entry.code === '') {
      return invalid('a catalog entry has no code');
    }
    if (codes.has(entry.code)) return invalid(`duplicate catalog code "${entry.code}"`);
    codes.add(entry.code);

    if (typeof entry.backend_module !== 'string' || typeof entry.backend_submodule !== 'string') {
      return invalid(`entry "${entry.code}" has no backend module/submodule key`);
    }
    if (entry.status !== STATUS.ACTIVE) continue;

    activeCount += 1;
    if (!String(entry.label || '').trim()) return invalid(`active entry "${entry.code}" has no label`);
    if (!Array.isArray(entry.supported_actions) || entry.supported_actions.length === 0) {
      return invalid(`active entry "${entry.code}" declares no actions`);
    }
    for (const action of entry.supported_actions) {
      if (PERM_BITS[action] === undefined) {
        return invalid(`active entry "${entry.code}" uses unknown action "${action}"`);
      }
    }

    // Two editable entries writing the same row would produce a duplicate
    // module/submodule in the payload, which the API cannot represent.
    const key = overrideKey(entry.backend_module, entry.backend_submodule);
    if (storageKeys.has(key)) return invalid(`two active entries write the same key "${key}"`);
    storageKeys.add(key);
  }

  if (activeCount === 0) return invalid('the catalog contains no active permissions');
  return { ok: true, reason: null };
}

/* ── Capabilities ───────────────────────────────────────────── */

/**
 * The legacy `submodule = ''` convention must never render as a blank cell, so
 * the module-access meaning is spelled out instead.
 */
function submoduleLabelOf(entry) {
  if (entry.backend_submodule !== '') return entry.backend_submodule;
  return entry.empty_submodule_meaning === 'MODULE_ACCESS'
    ? 'module-level access'
    : 'module-level compatibility row';
}

/** One catalog entry as the editor sees it. Frozen: components never patch it. */
export function buildCapability(entry) {
  const supported = new Set(entry.supported_actions || []);
  const actions = ACTION_ORDER
    .filter(id => supported.has(id))
    .map(id => Object.freeze({ id, label: ACTION_LABELS.get(id), bit: PERM_BITS[id] }));

  return Object.freeze({
    code: entry.code,
    storageKey: overrideKey(entry.backend_module, entry.backend_submodule),
    module: entry.backend_module,
    submodule: entry.backend_submodule,
    submoduleLabel: submoduleLabelOf(entry),
    label: entry.label,
    description: entry.description || '',
    status: entry.status,
    riskLevel: entry.risk_level || null,
    controlType: entry.control_type || null,
    isModuleAccess: entry.backend_submodule === '',
    /** false ⇒ Brick 1 verified there is no seeded role_permissions row. */
    hasBaselineRow: entry.has_baseline_rows !== false,
    canonicalCode: entry.canonical_code || null,
    enforcement: entry.enforcement || {},
    enforcementLevel: enforcementLevelOf(entry.enforcement),
    actions: Object.freeze(actions),
    supportedMask: actions.reduce((mask, a) => mask | a.bit, 0),
    notes: Object.freeze([...(entry.notes || [])]),
  });
}

/**
 * Business groups in the catalog's own declared order, each split into the
 * editable ACTIVE capabilities and the read-only diagnostic remainder.
 *
 * Membership is never hard-coded — a group exists because the endpoint says so.
 */
export function buildGroups(catalog) {
  const buckets = new Map();
  const ensure = (name) => {
    if (!buckets.has(name)) buckets.set(name, { name, capabilities: [], diagnostics: [] });
    return buckets.get(name);
  };

  // Seed the declared order first so groups render in catalog order even when
  // their first entry appears later in the permission list.
  for (const group of catalog.groups || []) {
    const name = typeof group === 'string' ? group : group?.name;
    if (name) ensure(name);
  }

  for (const entry of catalog.permissions) {
    const bucket = ensure(entry.business_group || 'Ungrouped');
    const capability = buildCapability(entry);
    if (capability.status === STATUS.ACTIVE) bucket.capabilities.push(capability);
    else bucket.diagnostics.push(capability);
  }

  return [...buckets.values()].filter(b => b.capabilities.length > 0 || b.diagnostics.length > 0);
}

/** Every storage key an ACTIVE capability owns — used to identify hidden rows. */
export function activeStorageKeys(groups) {
  const keys = new Set();
  for (const group of groups) {
    for (const capability of group.capabilities) keys.add(capability.storageKey);
  }
  return keys;
}
