/**
 * RBAC Brick 8 — authorization telemetry.
 *
 * Two jobs, deliberately kept apart:
 *
 *   1. DENIAL COUNTERS. A 403 under STRICT is an ordinary, expected event — a
 *      user pressed a button they are not entitled to. Logging one line per
 *      occurrence buries the interesting events, so denials are counted and only
 *      the first of each distinct kind is written to the log.
 *
 *   2. SHADOW MISMATCHES. These are the point of the whole rollout: a request
 *      the legacy chain allowed and the capability model would refuse, or the
 *      reverse. Every distinct one is kept, capped, so a rollout can be
 *      inspected without a log pipeline.
 *
 * WHAT IS NEVER RECORDED
 * ───────────────────────
 * No token of any kind, no request body, no query string, no header. The
 * numeric user id is kept because a mismatch is unusable without knowing whose
 * configuration produced it; nothing else about the user is stored.
 *
 * The buffers are bounded and per-process. This is a diagnostic surface for a
 * staged rollout, not an audit log — `services/security/securityAuditService`
 * remains the durable record.
 */

'use strict';

const { logger } = require('../../middleware/logger');

/** Enough to characterise a rollout; small enough to never matter for memory. */
const MAX_MISMATCHES = 500;

/** Distinct denial kinds worth logging once each before falling silent. */
const MAX_LOGGED_DENIAL_KINDS = 200;

/**
 * Why a decision came out the way it did. A closed vocabulary so the mismatch
 * report can be aggregated rather than read line by line.
 */
const DENIAL_REASONS = Object.freeze({
  NO_USER: 'NO_USER',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  UNKNOWN_CAPABILITY: 'UNKNOWN_CAPABILITY',
  MISSING_BIT: 'MISSING_BIT',
  RESOLVER_UNAVAILABLE: 'RESOLVER_UNAVAILABLE',
});

const state = {
  denialsByKey: new Map(), // "group|capability|action|reason" → count
  loggedDenialKeys: new Set(),
  mismatches: [],
  mismatchesDropped: 0,
  shadowEvaluations: 0,
  shadowAgreements: 0,
  shadowFailures: 0,
};

/* ── Denials (STRICT) ──────────────────────────────────────────────────────── */

/**
 * @param {object} d
 * @param {string} d.group      rollout group
 * @param {string} d.capability catalog code, e.g. "inventory.stock_transfer"
 * @param {string} d.action
 * @param {string} d.reason     one of DENIAL_REASONS
 * @param {string} d.method
 * @param {string} d.route      the route PATTERN, never the resolved URL
 * @param {number|string|null} d.userId
 * @param {string|null} d.role
 */
function recordDenial(d) {
  const key = `${d.group}|${d.capability}|${d.action}|${d.reason}`;
  state.denialsByKey.set(key, (state.denialsByKey.get(key) || 0) + 1);

  if (
    !state.loggedDenialKeys.has(key) &&
    state.loggedDenialKeys.size < MAX_LOGGED_DENIAL_KINDS
  ) {
    state.loggedDenialKeys.add(key);
    logger.warn('[rbac] strict permission denied', {
      group: d.group,
      capability: d.capability,
      action: d.action,
      reason: d.reason,
      method: d.method,
      route: d.route,
      userId: d.userId ?? null,
      role: d.role ?? null,
      note: 'first occurrence of this denial kind; later ones are counted only',
    });
  }
}

/* ── Shadow comparisons ────────────────────────────────────────────────────── */

/**
 * Record what STRICT would have decided alongside what actually happened.
 *
 * `legacyAllowed` is observed from the real response status, not simulated, so
 * the comparison is against what the user genuinely experienced.
 */
function recordShadow(entry) {
  state.shadowEvaluations += 1;

  if (entry.strictError) {
    state.shadowFailures += 1;
  }

  if (entry.legacyAllowed === entry.strictAllowed && !entry.strictError) {
    state.shadowAgreements += 1;
    return;
  }

  if (state.mismatches.length >= MAX_MISMATCHES) {
    state.mismatchesDropped += 1;
    return;
  }

  state.mismatches.push(Object.freeze({
    method: entry.method,
    route: entry.route,
    group: entry.group,
    capability: entry.capability,
    action: entry.action,
    legacy: entry.legacyAllowed ? 'allow' : 'deny',
    strict: entry.strictAllowed ? 'allow' : 'deny',
    reason: entry.reason || null,
    strictError: entry.strictError || null,
    userId: entry.userId ?? null,
    role: entry.role ?? null,
    statusCode: entry.statusCode ?? null,
  }));
}

/* ── Reporting ─────────────────────────────────────────────────────────────── */

/**
 * Aggregate view for the rollout. Split by direction because the two mean
 * opposite things: LEGACY_ALLOW_STRICT_DENY is a user about to lose access,
 * LEGACY_DENY_STRICT_ALLOW is an over-restrictive role string today.
 */
function getMismatchReport() {
  const legacyAllowStrictDeny = [];
  const legacyDenyStrictAllow = [];

  for (const m of state.mismatches) {
    if (m.legacy === 'allow' && m.strict === 'deny') legacyAllowStrictDeny.push(m);
    else if (m.legacy === 'deny' && m.strict === 'allow') legacyDenyStrictAllow.push(m);
  }

  const byReason = {};
  for (const m of state.mismatches) {
    const r = m.reason || 'NONE';
    byReason[r] = (byReason[r] || 0) + 1;
  }

  return {
    evaluations: state.shadowEvaluations,
    agreements: state.shadowAgreements,
    mismatches: state.mismatches.length,
    dropped: state.mismatchesDropped,
    evaluation_failures: state.shadowFailures,
    legacy_allow_strict_deny: legacyAllowStrictDeny,
    legacy_deny_strict_allow: legacyDenyStrictAllow,
    by_reason: byReason,
  };
}

function getDenialReport() {
  const rows = [];
  for (const [key, count] of state.denialsByKey.entries()) {
    const [group, capability, action, reason] = key.split('|');
    rows.push({ group, capability, action, reason, count });
  }
  rows.sort((a, b) => b.count - a.count);
  return rows;
}

function getSnapshot() {
  return {
    denials: getDenialReport(),
    shadow: getMismatchReport(),
  };
}

function reset() {
  state.denialsByKey.clear();
  state.loggedDenialKeys.clear();
  state.mismatches.length = 0;
  state.mismatchesDropped = 0;
  state.shadowEvaluations = 0;
  state.shadowAgreements = 0;
  state.shadowFailures = 0;
}

module.exports = {
  DENIAL_REASONS,
  MAX_MISMATCHES,
  recordDenial,
  recordShadow,
  getMismatchReport,
  getDenialReport,
  getSnapshot,
  reset,
};
