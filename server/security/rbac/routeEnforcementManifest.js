/**
 * RBAC Brick 8 — the canonical route enforcement manifest.
 *
 * Assembles the per-group classification files, refuses duplicates, and exposes
 * the lookups the installer and the tests need. Every registered Express route
 * must appear here exactly once; brick8RouteCoverage.test.js walks the built
 * router and fails on the first route with no entry, so a new endpoint cannot
 * reach production unclassified.
 *
 * It stores no permission metadata of its own. Labels, risk, supported actions
 * and baseline-row facts all live in the Brick 1 catalog and are read from it.
 */

'use strict';

const catalog = require('../../rbac/permissionCatalog');
const { ROLLOUT_GROUPS } = require('./enforcementConfig');
const { STATUS, GUARD, AUTHORITY, ALL_STATUSES } = require('./manifest/defineRoute');
const { keyOf } = require('./routeIntrospection');

const ENTRIES = Object.freeze([
  ...require('./manifest/general'),
  ...require('./manifest/inventory'),
  ...require('./manifest/stockTransfer'),
  ...require('./manifest/manufacturing'),
  ...require('./manifest/masterData'),
  ...require('./manifest/commerce'),
  ...require('./manifest/accounting'),
  ...require('./manifest/assetsReports'),
  ...require('./manifest/admin'),
]);

/* ── Index ─────────────────────────────────────────────────────────────────── */

const BY_KEY = new Map();
for (const entry of ENTRIES) {
  if (BY_KEY.has(entry.key)) {
    throw new Error(
      `[rbac-route-manifest] duplicate entry for "${entry.key}". Each method+path is classified once.`,
    );
  }
  BY_KEY.set(entry.key, entry);
}

/** @returns {object|null} the entry for a registered route, or null. */
function getEntry(method, path) {
  return BY_KEY.get(keyOf(method, path)) || null;
}

function getAll() {
  return ENTRIES;
}

/* ── Reporting ─────────────────────────────────────────────────────────────── */

function getSummary() {
  const byStatus = {};
  for (const status of ALL_STATUSES) byStatus[status] = 0;
  const byGroup = {};
  for (const group of ROLLOUT_GROUPS) {
    byGroup[group] = { total: 0, enforced: 0, mutations: 0, blocked: 0 };
  }

  let mutations = 0;
  let guardedAtRoute = 0;
  let guardedInHandler = 0;

  for (const e of ENTRIES) {
    byStatus[e.status] += 1;
    if (e.mutation) mutations += 1;
    if (e.guard === GUARD.ROUTE) guardedAtRoute += 1;
    if (e.guard === GUARD.HANDLER) guardedInHandler += 1;

    if (e.group && byGroup[e.group]) {
      byGroup[e.group].total += 1;
      if (e.mutation) byGroup[e.group].mutations += 1;
      if (e.status === STATUS.EFFECTIVE_PERMISSION_ENFORCED) byGroup[e.group].enforced += 1;
      if (e.status === STATUS.SECURITY_BLOCKED) byGroup[e.group].blocked += 1;
    }
  }

  return {
    total: ENTRIES.length,
    mutations,
    by_status: byStatus,
    by_group: byGroup,
    guarded_at_route: guardedAtRoute,
    guarded_in_handler: guardedInHandler,
  };
}

/** Distinct catalog codes this manifest enforces against. */
function getUsedCapabilities() {
  return [...new Set(ENTRIES.filter((e) => e.capability).map((e) => e.capability))].sort();
}

/**
 * Capabilities with no seeded role_permissions row.
 *
 * These are the routes that would answer 403 for every user except Super Admin
 * the moment their group reaches STRICT, and they are the reason a rollout runs
 * through SHADOW first. Reported, never auto-granted.
 */
function getMissingBaselineCapabilities() {
  const out = [];
  for (const code of getUsedCapabilities()) {
    const entry = catalog.getByCode(code);
    if (entry && entry.has_baseline_rows === false) {
      out.push({
        capability: code,
        label: entry.label,
        routes: ENTRIES.filter((e) => e.capability === code).map((e) => e.key),
      });
    }
  }
  return out;
}

/**
 * Everything that must be settled by a human before the named group is allowed
 * to reach STRICT. Consumed by the rollout documentation and by the tests that
 * assert no blocker is silently dropped.
 */
function getPreStrictBlockers(group = null) {
  const inGroup = (e) => !group || e.group === group;

  return {
    security_blocked: ENTRIES.filter((e) => inGroup(e) && e.status === STATUS.SECURITY_BLOCKED).map(
      (e) => ({ key: e.key, reason: e.reason, notes: e.notes }),
    ),
    missing_baseline: getMissingBaselineCapabilities().filter(
      (m) => !group || m.routes.some((k) => BY_KEY.get(k).group === group),
    ),
    authority_model_missing: ENTRIES.filter(
      (e) => inGroup(e) && e.authority === AUTHORITY.MODEL_MISSING,
    ).map((e) => ({ key: e.key, capability: e.capability, notes: e.notes })),
  };
}

module.exports = {
  ENTRIES,
  BY_KEY,
  STATUS,
  GUARD,
  AUTHORITY,
  getEntry,
  getAll,
  getSummary,
  getUsedCapabilities,
  getMissingBaselineCapabilities,
  getPreStrictBlockers,
};
