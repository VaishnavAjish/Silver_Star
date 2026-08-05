/**
 * RBAC Brick 1 — live extraction of permission REFERENCES from source.
 *
 * The catalog claims what the system does; this module reads the actual source
 * files and reports what the system really references. Tests compare the two,
 * so a hand-written catalog can never silently drift from the code.
 *
 * READ-ONLY and best-effort. On a server where client/ is not deployed the
 * client extractors return null instead of throwing, and the catalog endpoint
 * degrades to backend-only coverage.
 *
 * This module is NEVER consulted during permission resolution.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const SERVER_ROOT = path.join(__dirname, '..');
const REPO_ROOT   = path.join(SERVER_ROOT, '..');
const CLIENT_ROOT = path.join(REPO_ROOT, 'client');

/** Read a file relative to the repo root; null when missing/unreadable. */
function readRepoFile(relPath) {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
  } catch {
    return null;
  }
}

function listFiles(dir, filter) {
  try {
    return fs.readdirSync(dir).filter(filter).map(f => path.join(dir, f));
  } catch {
    return [];
  }
}

function toRepoRelative(absPath) {
  return path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
}

/* ── MODULE_TREE extraction ────────────────────────────────────────────────
 * Both trees use the same literal shape:
 *   { module: 'x', label: '…', submodules: [ { key: 'y', label: '…' }, … ] }
 * Scanning line by line and attaching each `key:` to the most recent `module:`
 * is exact for that shape and tolerates the formatting differences between the
 * two files.
 */
function parseModuleTree(source, file) {
  if (!source) return null;
  const out = [];
  let currentModule = null;

  source.split(/\r?\n/).forEach((line, idx) => {
    const moduleMatch = line.match(/\bmodule:\s*'([^']+)'/);
    if (moduleMatch) currentModule = moduleMatch[1];

    // A compact row keeps module and its single submodule on ONE line
    // (roles.js:27 dashboard), so both must be read from the same line.
    if (!currentModule) return;
    const keyRe = /\{\s*key:\s*'([^']+)'/g;
    let m;
    while ((m = keyRe.exec(line)) !== null) {
      out.push({ module: currentModule, submodule: m[1], file, line: idx + 1 });
    }
  });
  return out;
}

/** Seeded keys: server/routes/roles.js MODULE_TREE drives the startup seeder. */
function getServerModuleTree() {
  const rel = 'server/routes/roles.js';
  return parseModuleTree(readRepoFile(rel), rel);
}

/** Keys the Role Management grid writes: client/src/shared/constants/permissions.js. */
function getClientModuleTree() {
  const rel = 'client/src/shared/constants/permissions.js';
  return parseModuleTree(readRepoFile(rel), rel);
}

/* ── Sidebar / navigation registry ─────────────────────────────────────────
 * Every NAVIGATION leaf and CREATE_ACTION is one object literal per line.
 */
function getSidebarRefs() {
  const rel = 'client/src/core/navigation/registry.js';
  const source = readRepoFile(rel);
  if (!source) return null;

  const out = [];
  source.split(/\r?\n/).forEach((line, idx) => {
    const moduleMatch = line.match(/\bmodule:\s*'([^']+)'/);
    if (!moduleMatch) return;
    const idMatch  = line.match(/\bid:\s*'([^']+)'/);
    const subMatch = line.match(/\bsubmodule:\s*'([^']*)'/);
    const actMatch = line.match(/requiredAction:\s*'([^']+)'/);
    out.push({
      id:             idMatch ? idMatch[1] : null,
      module:         moduleMatch[1],
      submodule:      subMatch ? subMatch[1] : '',
      requiredAction: actMatch ? actMatch[1] : null,
      editorOnly:     /\beditorOnly:\s*true/.test(line),
      adminOnly:      /\badminOnly:\s*true/.test(line),
      file: rel,
      line: idx + 1,
    });
  });
  return out;
}

/* ── Frontend route guards ─────────────────────────────────────────────────
 * client/src/modules/<name>/routes.js:
 *   requirePermission: { module: 'inventory', action: 'view', submodule: 'x' }
 */
const ROUTE_GUARD_RE =
  /requirePermission:\s*\{\s*module:\s*'([^']+)'\s*,\s*action:\s*'([^']+)'\s*(?:,\s*submodule:\s*'([^']*)')?/g;

function getFrontendRouteGuards() {
  const modulesDir = path.join(CLIENT_ROOT, 'src', 'modules');
  let moduleDirs;
  try {
    moduleDirs = fs.readdirSync(modulesDir);
  } catch {
    return null;
  }

  const out = [];
  for (const name of moduleDirs) {
    const abs = path.join(modulesDir, name, 'routes.js');
    let source;
    try {
      source = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const rel = toRepoRelative(abs);
    source.split(/\r?\n/).forEach((line, idx) => {
      ROUTE_GUARD_RE.lastIndex = 0;
      let m;
      while ((m = ROUTE_GUARD_RE.exec(line)) !== null) {
        out.push({
          module: m[1], action: m[2], submodule: m[3] || '',
          file: rel, line: idx + 1,
        });
      }
    });
  }
  return out;
}

/* ── Backend resolver call sites ───────────────────────────────────────────
 * Helper signatures in use:
 *   hasPermission(userId, module, action, submodule?)
 *   resolveEffectivePermission(userId, module, submodule?)
 *   getUserPermissionBitmask(userId, module, submodule?)
 *   checkPermission(module, action, submodule?)          — middleware factory
 *   permission: { module, submodule }                    — export registry
 *
 * Matching runs over the WHOLE file, not line by line, because several guards
 * wrap their arguments across lines (inventory.js:976, inventoryCorrectionService.js:111).
 * An action argument that is a variable rather than a literal (inventory.js:1050
 * passes `action`) yields action: null — the KEY is still recorded, which is
 * what the mapping invariant checks.
 *
 * Calls whose MODULE argument is a variable (reports.js resolves
 * def.permission.module at runtime) cannot be resolved statically and are
 * covered instead by the accountingExportRegistry literals.
 */
const QUOTED = "'([^']*)'";
const ARG = '[^,()]+';

const GUARD_PATTERNS = [
  {
    helper: 'hasPermission',
    re: new RegExp(`\\bhasPermission\\(\\s*${ARG},\\s*${QUOTED}\\s*,\\s*(?:${QUOTED}|${ARG})\\s*(?:,\\s*${QUOTED})?`, 'g'),
    map: m => ({ module: m[1], action: m[2] || null, submodule: m[3] || '' }),
  },
  {
    helper: 'checkPermission',
    re: new RegExp(`\\bcheckPermission\\(\\s*${QUOTED}\\s*,\\s*${QUOTED}\\s*(?:,\\s*${QUOTED})?`, 'g'),
    map: m => ({ module: m[1], action: m[2], submodule: m[3] || '' }),
  },
  {
    helper: 'getUserPermissionBitmask',
    re: new RegExp(`\\bgetUserPermissionBitmask\\(\\s*${ARG},\\s*${QUOTED}\\s*(?:,\\s*${QUOTED})?`, 'g'),
    map: m => ({ module: m[1], action: null, submodule: m[2] || '' }),
  },
  {
    helper: 'resolveEffectivePermission',
    re: new RegExp(`\\bresolveEffectivePermission\\(\\s*${ARG},\\s*${QUOTED}\\s*(?:,\\s*${QUOTED})?`, 'g'),
    map: m => ({ module: m[1], action: null, submodule: m[2] || '' }),
  },
  {
    helper: 'exportRegistry',
    re: new RegExp(`permission:\\s*\\{\\s*module:\\s*${QUOTED}\\s*,\\s*submodule:\\s*${QUOTED}`, 'g'),
    map: m => ({ module: m[1], action: 'view', submodule: m[2] || '' }),
  },
];

const IS_JS = f => f.endsWith('.js');

/** 1-indexed line number of a character offset. */
function lineAt(source, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') line++;
  }
  return line;
}

/** True when the match sits inside a `//` or `*` comment line (JSDoc examples). */
function isCommentMatch(source, offset) {
  const lineStart = source.lastIndexOf('\n', offset) + 1;
  const prefix = source.slice(lineStart, offset).trim();
  return prefix.startsWith('*') || prefix.startsWith('//') || prefix.startsWith('/*');
}

function getBackendGuards() {
  const files = [
    ...listFiles(path.join(SERVER_ROOT, 'routes'), IS_JS),
    ...listFiles(path.join(SERVER_ROOT, 'services'), IS_JS),
    ...listFiles(path.join(SERVER_ROOT, 'middleware'), IS_JS),
  ];

  const out = [];
  for (const abs of files) {
    let source;
    try {
      source = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const rel = toRepoRelative(abs);
    for (const { helper, re, map } of GUARD_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(source)) !== null) {
        if (isCommentMatch(source, m.index)) continue;
        out.push({ ...map(m), helper, file: rel, line: lineAt(source, m.index) });
      }
    }
  }
  return out;
}

/* ── Frontend permission-bit tables ────────────────────────────────────────
 * Three bit tables exist: the server's PERM_BITS, the shared client constant,
 * and a private copy inside AuthContext. A key missing from any of them can
 * never be granted through that surface, so drift is a real access defect.
 */
function parseBitTable(source, declRe) {
  if (!source) return null;
  const decl = source.match(declRe);
  if (!decl) return null;
  const bits = {};
  const entryRe = /(\w+):\s*(\d+)/g;
  let m;
  while ((m = entryRe.exec(decl[1])) !== null) bits[m[1]] = Number(m[2]);
  return bits;
}

function getFrontendBitTables() {
  return {
    sharedConstant: parseBitTable(
      readRepoFile('client/src/shared/constants/permissions.js'),
      /export const PERM_BITS\s*=\s*\{([\s\S]*?)\}/
    ),
    authContext: parseBitTable(
      readRepoFile('client/src/core/context/AuthContext.jsx'),
      /_PERM_BITS\s*=\s*\{([\s\S]*?)\}/
    ),
  };
}

/**
 * Collect every source-side permission reference in one pass.
 * `available` is false only when a CLIENT source cannot be read — the backend
 * extractors always work because this file ships beside them.
 */
function collectSourceRefs() {
  const serverModuleTree    = getServerModuleTree();
  const clientModuleTree    = getClientModuleTree();
  const sidebar             = getSidebarRefs();
  const frontendRouteGuards = getFrontendRouteGuards();
  const backendGuards       = getBackendGuards();

  const unreadable = [];
  if (!serverModuleTree)    unreadable.push('server/routes/roles.js');
  if (!clientModuleTree)    unreadable.push('client/src/shared/constants/permissions.js');
  if (!sidebar)             unreadable.push('client/src/core/navigation/registry.js');
  if (!frontendRouteGuards) unreadable.push('client/src/modules/*/routes.js');

  return {
    available: unreadable.length === 0,
    unreadable,
    serverModuleTree:    serverModuleTree || [],
    clientModuleTree:    clientModuleTree || [],
    sidebar:             sidebar || [],
    frontendRouteGuards: frontendRouteGuards || [],
    backendGuards,
    frontendBitTables:   getFrontendBitTables(),
  };
}

module.exports = {
  REPO_ROOT,
  collectSourceRefs,
  getServerModuleTree,
  getClientModuleTree,
  getSidebarRefs,
  getFrontendRouteGuards,
  getBackendGuards,
  getFrontendBitTables,
};
