/**
 * RBAC Brick 8 — module rollout configuration.
 *
 * WHY THREE MODES AND NOT A BOOLEAN
 * ──────────────────────────────────
 * Before Brick 8 no production route consulted the effective-permission
 * resolver. Authorization was `authorize('admin', 'operator')` role strings,
 * plus a handful of in-handler `hasPermission` calls. That means the permission
 * configuration administrators edit in the Admin Panel and what the API
 * actually enforces have never been compared on a live request.
 *
 * Flipping straight from role strings to capability bits would therefore be a
 * blind change: every disagreement between the two models would surface as a
 * user losing access mid-shift. SHADOW exists so the disagreements can be
 * enumerated BEFORE they can deny anybody.
 *
 *   LEGACY  the request is authorized exactly as it is today. The Brick 8 guard
 *           returns immediately and performs no database work. This is the
 *           default for every group and the state this code ships in.
 *   SHADOW  the legacy chain still decides the response. The guard additionally
 *           computes what STRICT would have decided and records the pair. It
 *           can neither allow nor deny.
 *   STRICT  the effective-permission resolver decides, and the coarse role-string
 *           guard for that capability is stepped over so it cannot veto a
 *           user-specific ALLOW.
 *
 * WHY PER-GROUP AND NOT ONE GLOBAL SWITCH
 * ────────────────────────────────────────
 * Enabling Accounting must be possible without also enabling Administration —
 * an Administration mistake can lock every administrator out of the panel that
 * would fix it. Each group also has to roll back on its own, by environment
 * variable, without a redeploy.
 *
 * INVALID VALUES REFUSE TO BOOT
 * ──────────────────────────────
 * `RBAC_ENFORCE_ACCOUNTING=strct` must not quietly mean LEGACY: during a
 * rollout that reads as "enforcement is on and nothing broke". The server
 * refuses to start instead, matching config/security.js, which exits when a
 * required secret is missing.
 */

'use strict';

/* ── Modes ─────────────────────────────────────────────────────────────────── */

const MODES = Object.freeze({
  LEGACY: 'legacy',
  SHADOW: 'shadow',
  STRICT: 'strict',
});

const ALL_MODES = Object.freeze([MODES.LEGACY, MODES.SHADOW, MODES.STRICT]);

/**
 * Accepted spellings. `false`/`off`/`0` and `true`/`on`/`1` are honoured because
 * the Brick 8 specification wrote the flags as booleans; they map onto the two
 * end states and never onto SHADOW, which must always be asked for by name.
 */
const MODE_ALIASES = Object.freeze({
  legacy: MODES.LEGACY,
  off: MODES.LEGACY,
  false: MODES.LEGACY,
  0: MODES.LEGACY,
  shadow: MODES.SHADOW,
  report: MODES.SHADOW,
  'report-only': MODES.SHADOW,
  strict: MODES.STRICT,
  on: MODES.STRICT,
  true: MODES.STRICT,
  1: MODES.STRICT,
});

/* ── Rollout groups ────────────────────────────────────────────────────────── */

/**
 * Declaration order is the RECOMMENDED activation order, lowest blast radius
 * first. It is documentation, not a constraint — any group can be moved on its
 * own. `admin` is last because a wrong Administration mask removes the only
 * surface able to correct it, and `accounting` second-to-last because a denial
 * there stops money movement rather than a screen refresh.
 */
const ROLLOUT_GROUPS = Object.freeze([
  'general',
  'inventory',
  'inventory_management',
  'stock_transfer',
  'reports',
  'manufacturing',
  'rough',
  'master_data',
  'purchase',
  'sales',
  'assets',
  'accounting',
  'admin',
]);

const GROUP_SET = new Set(ROLLOUT_GROUPS);

/** Environment variable that carries a group's mode. */
function envVarFor(group) {
  return `RBAC_ENFORCE_${String(group).toUpperCase()}`;
}

/**
 * Default for any group whose own variable is unset. Exists so a rollout can be
 * driven from one variable in an emergency, and so a full rollback is one edit.
 * Absent ⇒ LEGACY.
 */
const DEFAULT_ENV_VAR = 'RBAC_ENFORCE_DEFAULT';

/* ── Parsing ───────────────────────────────────────────────────────────────── */

function normaliseRaw(raw) {
  return String(raw).trim().toLowerCase();
}

/**
 * @returns {{mode: string}|{error: string}} — never a silent fallback.
 */
function parseMode(raw, source) {
  const key = normaliseRaw(raw);
  const mode = MODE_ALIASES[key];
  if (mode) return { mode };
  return {
    error:
      `${source}="${raw}" is not a valid RBAC enforcement mode. ` +
      `Use one of: ${ALL_MODES.join(', ')} ` +
      `(or the boolean spellings false/off/0 for legacy and true/on/1 for strict).`,
  };
}

/**
 * Read every group's mode out of an environment object.
 * Pure: takes the environment, returns modes plus the errors found.
 *
 * @param {object} env
 * @returns {{modes: Record<string,string>, errors: string[]}}
 */
function readModes(env = process.env) {
  const errors = [];

  let fallback = MODES.LEGACY;
  if (env[DEFAULT_ENV_VAR] !== undefined && env[DEFAULT_ENV_VAR] !== '') {
    const parsed = parseMode(env[DEFAULT_ENV_VAR], DEFAULT_ENV_VAR);
    if (parsed.error) errors.push(parsed.error);
    else fallback = parsed.mode;
  }

  const modes = {};
  for (const group of ROLLOUT_GROUPS) {
    const varName = envVarFor(group);
    const raw = env[varName];
    if (raw === undefined || raw === '') {
      modes[group] = fallback;
      continue;
    }
    const parsed = parseMode(raw, varName);
    if (parsed.error) {
      errors.push(parsed.error);
      modes[group] = fallback;
      continue;
    }
    modes[group] = parsed.mode;
  }

  // A variable that looks like ours but names no group is a typo in a security
  // control. Reporting it is the whole point of validating at startup.
  for (const key of Object.keys(env)) {
    if (!key.startsWith('RBAC_ENFORCE_')) continue;
    if (key === DEFAULT_ENV_VAR) continue;
    const group = key.slice('RBAC_ENFORCE_'.length).toLowerCase();
    if (!GROUP_SET.has(group)) {
      errors.push(
        `${key} does not name a known RBAC rollout group. ` +
          `Known groups: ${ROLLOUT_GROUPS.join(', ')}.`,
      );
    }
  }

  return { modes, errors };
}

/* ── Live state ────────────────────────────────────────────────────────────── */

let state = null;
/** Set by tests only; takes precedence over the environment for that group. */
const overrides = new Map();

function ensureState() {
  if (!state) state = readModes(process.env);
  return state;
}

/**
 * The mode in force for a rollout group.
 * An unknown group name is LEGACY: a manifest entry pointing at a group that
 * does not exist must never accidentally enforce.
 */
function getMode(group) {
  if (overrides.has(group)) return overrides.get(group);
  if (!GROUP_SET.has(group)) return MODES.LEGACY;
  return ensureState().modes[group];
}

function isStrict(group) {
  return getMode(group) === MODES.STRICT;
}

function isShadow(group) {
  return getMode(group) === MODES.SHADOW;
}

function isLegacy(group) {
  return getMode(group) === MODES.LEGACY;
}

/** Every group's current mode — for diagnostics and the startup log line. */
function getAllModes() {
  const out = {};
  for (const group of ROLLOUT_GROUPS) out[group] = getMode(group);
  return out;
}

/** True when no group is doing anything beyond today's behaviour. */
function isEntirelyLegacy() {
  return ROLLOUT_GROUPS.every((g) => getMode(g) === MODES.LEGACY);
}

/**
 * Startup gate. Throws on any unusable value rather than guessing.
 * Call once from app.js before the first request is served.
 *
 * @param {object} [env]
 * @returns {Record<string,string>} the validated modes
 */
function validateEnforcementConfig(env = process.env) {
  const { modes, errors } = readModes(env);
  if (errors.length) {
    throw new Error(
      `[rbac-enforcement] invalid configuration:\n  - ${errors.join('\n  - ')}`,
    );
  }
  if (env === process.env) state = { modes, errors };
  return modes;
}

/* ── Compatibility switches ────────────────────────────────────────────────── */
/*
 * Two long-standing inconsistencies were found during the Brick 8 audit. Both
 * are settled the same way: one canonical implementation, two modes, and the
 * mode that reproduces today's behaviour as the default.
 *
 * Neither can be resolved by reading the code, because both turn on business
 * intent that was never written down, and this brick may not decide it.
 */

/**
 * Who bypasses inventory department scope.
 *
 * `compatibility` — reproduces today's split behaviour exactly, including the
 *   disagreement Brick 4 found: requireInventoryView admits a nine-role list to
 *   unrestricted scope, while loadDeptScope admits only Super Admin, so the same
 *   administrator sees everything on the Inventory page and their stored scope
 *   on Stock Transfer.
 * `canonical`     — one rule everywhere: only Super Admin bypasses, and every
 *   other role gets the scope an administrator configured for them.
 *
 * Default `compatibility`. Switching to `canonical` NARROWS what administrators,
 * managers, owners and developers can see, which is a live access change and an
 * owner's decision.
 */
const SCOPE_POLICY_VAR = 'RBAC_INVENTORY_SCOPE_POLICY';
const SCOPE_POLICIES = Object.freeze(['compatibility', 'canonical']);

function getInventoryScopePolicy(env = process.env) {
  const raw = normaliseRaw(env[SCOPE_POLICY_VAR] || 'compatibility');
  return SCOPE_POLICIES.includes(raw) ? raw : 'compatibility';
}

/**
 * Whether resolveEffectivePermission still falls back to the legacy
 * `user_permissions` table for a user with no role rows and no overrides.
 *
 * Brick 5 could not certify Default Deny while that fallback exists: a user with
 * no configuration at all can still receive permissions from a table nothing
 * writes to any more. It is believed empty, but the development database is
 * unreachable from here, so "believed" is the honest word and deleting the code
 * on that basis would be a guess.
 *
 * Default `true` — the fallback stays. Setting it false makes the resolver read
 * only from Super Admin bypass, role_permissions and user_permission_overrides,
 * which is the intended end state once the table is confirmed empty in
 * production. The table itself is never dropped by this code.
 */
const LEGACY_FALLBACK_VAR = 'RBAC_LEGACY_USER_PERMISSIONS_FALLBACK';

function isLegacyUserPermissionsFallbackEnabled(env = process.env) {
  return normaliseRaw(env[LEGACY_FALLBACK_VAR] || 'true') !== 'false';
}

/* ── Test seam ─────────────────────────────────────────────────────────────── */

function __setModeForTests(group, mode) {
  if (!ALL_MODES.includes(mode)) {
    throw new Error(`__setModeForTests: unknown mode "${mode}"`);
  }
  overrides.set(group, mode);
}

function __setModesForTests(map) {
  for (const [group, mode] of Object.entries(map)) __setModeForTests(group, mode);
}

function __resetForTests() {
  overrides.clear();
  state = null;
}

module.exports = {
  MODES,
  ALL_MODES,
  ROLLOUT_GROUPS,
  DEFAULT_ENV_VAR,
  envVarFor,

  readModes,
  validateEnforcementConfig,

  SCOPE_POLICY_VAR,
  SCOPE_POLICIES,
  LEGACY_FALLBACK_VAR,
  getInventoryScopePolicy,
  isLegacyUserPermissionsFallbackEnabled,

  getMode,
  getAllModes,
  isStrict,
  isShadow,
  isLegacy,
  isEntirelyLegacy,

  __setModeForTests,
  __setModesForTests,
  __resetForTests,
};
