/**
 * RBAC Brick 1 — catalog reconciliation and anomaly reporting.
 *
 * Two kinds of analysis live here:
 *
 *   1. STATIC   — derived purely from source. Always available, no database.
 *   2. BASELINE — derived from role_permissions rows the CALLER supplies.
 *                 This module never queries; it stays a pure function so the
 *                 same code serves the endpoint, the tests and offline runs.
 *
 * Nothing here changes a mask, a row or an authorization decision.
 */

'use strict';

const catalog = require('./permissionCatalog');
const sources = require('./catalogSources');
const { PERM_BITS, ALL_PERMISSION_BITS } = require('../utils/permissions');

/** Trust order — a lower-trust role must never exceed a higher-trust one. */
const ROLE_TRUST = Object.freeze({
  viewer: 1,
  operator_restricted: 1,
  operator: 2,
  admin: 3,
  super_admin: 4,
});

/** Bits that change data. A read-only role holding any of these is an anomaly. */
const MUTATION_BITS =
  PERM_BITS.create | PERM_BITS.edit | PERM_BITS.delete | PERM_BITS.approve
  | PERM_BITS.reject | PERM_BITS.import | PERM_BITS.manage
  | PERM_BITS.override_weight_variance;

const ANOMALY_SEVERITIES = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);

const ANOMALY_TYPES = Object.freeze([
  'UNMAPPED_SIDEBAR_CODE',
  'UNMAPPED_ROUTE_GUARD',
  'UNMAPPED_BACKEND_GUARD',
  'UNMAPPED_SEEDED_KEY',
  'UNMAPPED_DB_ROW',
  'MISSING_BASELINE_ROW',
  'SEEDED_KEY_WITHOUT_FEATURE',
  'INVALID_GUARD_ACTION',
  'MODULE_TREE_DRIFT',
  'BIT_TABLE_DRIFT',
  'HIGH_RISK_API_UNENFORCED',
  'LOWER_ROLE_EXCEEDS_HIGHER',
  'READ_ONLY_ROLE_HAS_MUTATION',
  'FULL_ACCESS_ON_HIGH_RISK',
  'LIVE_FEATURE_WITHOUT_ROW',
  'ROW_WITHOUT_LIVE_FEATURE',
]);

function anomaly(type, severity, code, detail, evidence = []) {
  return { type, severity, code, detail, evidence };
}

const keyOf = ref => catalog.codeFor(ref.module, ref.submodule || '');

const API_SURFACES = Object.freeze(
  ['api_list', 'api_detail', 'api_create', 'api_edit', 'api_delete']
);

/* ── Static analysis ───────────────────────────────────────────────────────── */

/**
 * Reconcile every source-side reference against the catalog.
 * @param {object} [refs] output of catalogSources.collectSourceRefs()
 */
function analyzeMapping(refs = sources.collectSourceRefs()) {
  const known = new Set(catalog.PERMISSIONS.map(p => p.code));
  const unmapped = list => list.filter(r => !known.has(keyOf(r)));

  const referenced = new Set([
    ...refs.sidebar.map(keyOf),
    ...refs.frontendRouteGuards.map(keyOf),
    ...refs.backendGuards.map(keyOf),
  ]);

  const serverKeys = new Set(refs.serverModuleTree.map(keyOf));
  const clientKeys = new Set(refs.clientModuleTree.map(keyOf));

  return {
    source_available:   refs.available,
    unreadable_sources: refs.unreadable,

    unmapped_sidebar:        unmapped(refs.sidebar),
    unmapped_route_guards:   unmapped(refs.frontendRouteGuards),
    unmapped_backend_guards: unmapped(refs.backendGuards),
    unmapped_server_tree:    unmapped(refs.serverModuleTree),
    unmapped_client_tree:    unmapped(refs.clientModuleTree),

    tree_drift: {
      server_only: [...serverKeys].filter(k => !clientKeys.has(k)),
      client_only: [...clientKeys].filter(k => !serverKeys.has(k)),
    },

    // ACTIVE catalog entries that no source file actually references.
    active_without_source_ref: catalog.PERMISSIONS
      .filter(p => p.status === 'ACTIVE' && !referenced.has(p.code))
      .map(p => p.code),
  };
}

/**
 * Anomalies derivable without a database connection.
 * @param {object} [refs] output of catalogSources.collectSourceRefs()
 */
function analyzeStatic(refs = sources.collectSourceRefs()) {
  const out = [];
  const mapping = analyzeMapping(refs);

  for (const ref of mapping.unmapped_sidebar) {
    out.push(anomaly('UNMAPPED_SIDEBAR_CODE', 'HIGH', keyOf(ref),
      'Sidebar entry references a permission key with no catalog entry.',
      [`${ref.file}:${ref.line}`]));
  }
  for (const ref of mapping.unmapped_route_guards) {
    out.push(anomaly('UNMAPPED_ROUTE_GUARD', 'HIGH', keyOf(ref),
      'Frontend route guard references a permission key with no catalog entry.',
      [`${ref.file}:${ref.line}`]));
  }
  for (const ref of mapping.unmapped_backend_guards) {
    out.push(anomaly('UNMAPPED_BACKEND_GUARD', 'CRITICAL', keyOf(ref),
      'Resolver call references a permission key with no catalog entry.',
      [`${ref.file}:${ref.line}`]));
  }
  for (const ref of [...mapping.unmapped_server_tree, ...mapping.unmapped_client_tree]) {
    out.push(anomaly('UNMAPPED_SEEDED_KEY', 'HIGH', keyOf(ref),
      'MODULE_TREE seeds a key with no catalog entry.', [`${ref.file}:${ref.line}`]));
  }

  for (const entry of catalog.PERMISSIONS) {
    // A live feature whose key the seeder never creates.
    if (entry.status === 'ACTIVE' && !entry.has_baseline_rows) {
      out.push(anomaly('MISSING_BASELINE_ROW', 'HIGH', entry.code,
        'Live feature with no seeded role_permissions row — only Super Admin passes.',
        entry.backend_refs.concat(entry.frontend_refs)));
    }
    // A seeded key nothing reads.
    if ((entry.status === 'LEGACY_ORPHAN' || entry.status === 'PLANNED_INACTIVE')
        && entry.has_baseline_rows) {
      out.push(anomaly('SEEDED_KEY_WITHOUT_FEATURE', 'LOW', entry.code,
        `Permission rows exist but no live feature reads this key (${entry.status}).`,
        entry.backend_refs));
    }
    // High-risk feature with no resolver check on any API surface.
    const unguarded = API_SURFACES.every(s =>
      ['AUTHENTICATE_ONLY', 'NOT_ENFORCED'].includes(entry.enforcement[s]));
    if (entry.status === 'ACTIVE' && unguarded
        && (entry.risk_level === 'CRITICAL' || entry.risk_level === 'HIGH')) {
      out.push(anomaly('HIGH_RISK_API_UNENFORCED', 'HIGH', entry.code,
        `${entry.risk_level} capability: no API surface consults the effective-permission resolver.`,
        entry.backend_refs));
    }
  }

  // Guards asking for an action that is not a real bit can never succeed.
  for (const guard of refs.backendGuards) {
    if (guard.action && PERM_BITS[guard.action] === undefined) {
      out.push(anomaly('INVALID_GUARD_ACTION', 'CRITICAL', keyOf(guard),
        `Guard checks action "${guard.action}", which is not in PERM_BITS — `
        + 'hasPermission returns false for every non-super-admin (unconditional deny).',
        [`${guard.file}:${guard.line}`]));
    }
  }

  for (const code of mapping.tree_drift.server_only) {
    out.push(anomaly('MODULE_TREE_DRIFT', 'MEDIUM', code,
      'Key is seeded by the server MODULE_TREE but absent from the client grid, '
      + 'so saving any role through the UI deletes its rows.',
      ['server/routes/roles.js', 'client/src/shared/constants/permissions.js']));
  }
  for (const code of mapping.tree_drift.client_only) {
    out.push(anomaly('MODULE_TREE_DRIFT', 'MEDIUM', code,
      'Key exists in the client grid but not in the server seeder, so rows appear '
      + 'only for roles edited through the UI.',
      ['client/src/shared/constants/permissions.js', 'server/routes/roles.js']));
  }

  // Bit-table drift: a bit missing from a surface can never be granted there.
  for (const [name, table] of Object.entries(refs.frontendBitTables || {})) {
    if (!table) continue;
    const missing = Object.keys(PERM_BITS).filter(a => table[a] === undefined);
    const mismatched = Object.keys(PERM_BITS)
      .filter(a => table[a] !== undefined && table[a] !== PERM_BITS[a]);
    if (missing.length || mismatched.length) {
      out.push(anomaly('BIT_TABLE_DRIFT', 'HIGH', null,
        `Frontend bit table "${name}" diverges from server PERM_BITS.`,
        [
          missing.length ? `missing: ${missing.join(', ')}` : null,
          mismatched.length ? `mismatched: ${mismatched.join(', ')}` : null,
        ].filter(Boolean)));
    }
  }

  return out;
}

/* ── Role-baseline analysis (caller supplies rows) ─────────────────────────── */

/**
 * Compare role baselines for the classic escalation shapes.
 * PURE: never queries, never mutates. Rows are read exactly as given.
 *
 * @param {Array<{role_slug:string, module:string, submodule:string, permissions:number}>} rows
 * @returns {Array<object>} anomalies
 */
function analyzeRoleBaselines(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const out = [];
  const byKey = new Map();

  for (const row of rows) {
    const code = catalog.codeFor(row.module, row.submodule || '');
    if (!byKey.has(code)) byKey.set(code, new Map());
    // BIT_OR semantics: a user may hold several roles, so merge duplicates.
    const prev = byKey.get(code).get(row.role_slug) || 0;
    byKey.get(code).set(row.role_slug, prev | (Number(row.permissions) || 0));
  }

  for (const [code, roleMasks] of byKey) {
    const entry = catalog.getByCode(code);
    const masksAsEvidence = [...roleMasks.entries()].map(([r, m]) => `${r}=${m}`);

    if (!entry) {
      out.push(anomaly('UNMAPPED_DB_ROW', 'HIGH', code,
        'role_permissions row whose module/submodule has no catalog entry.',
        masksAsEvidence));
      continue;
    }

    if (entry.status !== 'ACTIVE') {
      out.push(anomaly('ROW_WITHOUT_LIVE_FEATURE', 'LOW', code,
        `Rows exist for a ${entry.status} key.`, masksAsEvidence));
    }

    for (const [role, mask] of roleMasks) {
      const trust = ROLE_TRUST[role];
      if (trust === undefined) continue;

      // Read-only roles must never hold a mutation bit.
      if (trust === 1 && (mask & MUTATION_BITS) !== 0) {
        out.push(anomaly('READ_ONLY_ROLE_HAS_MUTATION', 'HIGH', code,
          `Read-only role "${role}" holds mutation bits.`,
          [`${role}=${mask}`, `mutation_bits=${mask & MUTATION_BITS}`]));
      }

      // Full access on a high-risk feature for anyone below admin.
      if (mask === ALL_PERMISSION_BITS && trust < ROLE_TRUST.admin
          && (entry.risk_level === 'CRITICAL' || entry.risk_level === 'HIGH')) {
        out.push(anomaly('FULL_ACCESS_ON_HIGH_RISK', 'CRITICAL', code,
          `Role "${role}" holds full access (${ALL_PERMISSION_BITS}) on a `
          + `${entry.risk_level} capability.`, [`${role}=${mask}`]));
      }

      // A lower-trust role must not grant anything a higher-trust role lacks.
      for (const [otherRole, otherMask] of roleMasks) {
        const otherTrust = ROLE_TRUST[otherRole];
        if (otherTrust === undefined || otherTrust <= trust) continue;
        const excess = mask & ~otherMask & ALL_PERMISSION_BITS;
        if (excess !== 0) {
          out.push(anomaly('LOWER_ROLE_EXCEEDS_HIGHER', 'HIGH', code,
            `Lower-trust role "${role}" (${mask}) grants bits denied to `
            + `"${otherRole}" (${otherMask}).`,
            [`${role}=${mask}`, `${otherRole}=${otherMask}`, `excess=${excess}`]));
        }
      }
    }
  }

  // Live features that no role row covers at all.
  for (const entry of catalog.PERMISSIONS) {
    if (entry.status !== 'ACTIVE') continue;
    if (byKey.has(entry.code)) continue;
    out.push(anomaly('LIVE_FEATURE_WITHOUT_ROW', 'HIGH', entry.code,
      'Active capability with no role_permissions row in any role.',
      entry.frontend_refs.concat(entry.backend_refs)));
  }

  return out;
}

module.exports = {
  ROLE_TRUST,
  MUTATION_BITS,
  ANOMALY_TYPES,
  ANOMALY_SEVERITIES,
  analyzeMapping,
  analyzeStatic,
  analyzeRoleBaselines,
};
