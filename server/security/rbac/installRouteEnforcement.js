/**
 * RBAC Brick 8 — bind the manifest to the live router.
 *
 * WHY BIND AFTER REGISTRATION INSTEAD OF EDITING FIFTY ROUTE FILES
 * ────────────────────────────────────────────────────────────────
 * Adding `requireEffectivePermission(...)` by hand to 422 method/path pairs
 * across 53 route files would be 422 chances to guard the wrong capability, and
 * the forty-eight endpoints `masterFactory` builds at runtime could not be
 * reached that way at all. Binding from the manifest means the classification
 * and the enforcement are the same artefact: they cannot drift, and the coverage
 * test can prove every route was reached.
 *
 * It uses Express's own matching. Nothing here re-implements routing — a guard
 * is inserted into the Route's own middleware stack, so it runs exactly when
 * that route runs, for exactly the method it was registered for.
 *
 * WHERE THE GUARD IS INSERTED, AND WHY NOT SIMPLY FIRST
 * ──────────────────────────────────────────────────────
 * Most routes sit behind the global `app.use('/api', … authenticate …)` gate, so
 * `req.user` is already populated. But app.js exempts `/api/auth` from that gate,
 * and two admin endpoints live there with their own route-level `authenticate`.
 * A guard placed at position zero would run before it, see no user, and answer
 * 401 to a perfectly valid administrator. So the guard is inserted immediately
 * AFTER the last authentication layer on the route, and only at position zero
 * when there is none.
 *
 * NO DUAL AUTHORIZATION
 * ──────────────────────
 * Under STRICT the role-string guard for the same capability is stepped over.
 * Leaving it in place would let `authorize('admin', 'operator')` veto a user who
 * holds an explicit per-user ALLOW — the exact case the override system exists
 * to serve. The wrapper is mode-aware and re-reads the mode per request, so a
 * rollback from STRICT to LEGACY restores the role-string guard immediately,
 * without a redeploy.
 *
 * Only `authorize()` and `checkPermission()` are stepped over, because only they
 * answer the same question. `requireInventoryView` resolves DEPARTMENT SCOPE and
 * financial-field visibility, which no capability bit replaces, so it always
 * runs.
 */

'use strict';

// Same internal module express-async-errors (a direct dependency of this server)
// requires, for the same reason: a Layer is the only object Route.dispatch knows
// how to run, and constructing one is the only way to add a step to a route.
const Layer = require('express/lib/router/layer');

const { collectRoutes, keyOf } = require('./routeIntrospection');
const manifest = require('./routeEnforcementManifest');
const config = require('./enforcementConfig');
const { requireEffectivePermission } = require('./requireEffectivePermission');
const { GUARD } = require('./manifest/defineRoute');
const { logger } = require('../../middleware/logger');

/** Layers that establish req.user. The guard must sit after the last of them. */
function isAuthenticationLayer(layer) {
  if (layer.handle && layer.handle.__rbacAuthenticate) return true;
  return layer.name === 'authenticate';
}

function insertionIndex(stack) {
  let index = 0;
  for (let i = 0; i < stack.length; i += 1) {
    if (isAuthenticationLayer(stack[i])) index = i + 1;
  }
  return index;
}

function makeLayer(method, handle) {
  const layer = new Layer('/', {}, handle);
  layer.method = String(method).toLowerCase();
  return layer;
}

/**
 * Replace a tagged legacy guard with a wrapper that steps over it while the
 * capability's group is STRICT. The mode is read per request, never captured.
 */
function wrapLegacyGuard(layer, groupsByMethod) {
  const original = layer.handle;

  function rbacLegacyGuardBridge(req, res, next) {
    const group = groupsByMethod.get(String(req.method).toUpperCase());
    if (group && config.isStrict(group)) return next();
    return original(req, res, next);
  }
  rbacLegacyGuardBridge.__rbacLegacyGuard = original.__rbacLegacyGuard;
  rbacLegacyGuardBridge.__rbacBridged = true;

  layer.handle = rbacLegacyGuardBridge;
}

/**
 * @param {import('express').Express} app
 * @param {{throwOnUnclassified?: boolean}} [options]
 * @returns {{routes:number, methodPaths:number, guardsInstalled:number,
 *            legacyGuardsWrapped:number, unclassified:string[]}}
 */
function installRouteEnforcement(app, options = {}) {
  const records = collectRoutes(app);

  const unclassified = [];
  let guardsInstalled = 0;
  let legacyGuardsWrapped = 0;
  let methodPaths = 0;

  for (const record of records) {
    /** METHOD → the manifest entry that governs it. */
    const entryByMethod = new Map();

    for (const method of record.methods) {
      const entries = [];
      for (const path of record.paths) {
        methodPaths += 1;
        const entry = manifest.getEntry(method, path);
        if (!entry) {
          unclassified.push(keyOf(method, path));
          continue;
        }
        entries.push(entry);
      }
      if (!entries.length) continue;

      // A router mounted under several prefixes reaches one handler. Every alias
      // must therefore agree on what that handler is allowed to do; disagreement
      // would mean the same code enforcing two different capabilities depending
      // on which URL the client happened to use.
      const first = entries[0];
      for (const other of entries.slice(1)) {
        if (
          other.capability !== first.capability ||
          other.action !== first.action ||
          other.group !== first.group ||
          other.guard !== first.guard
        ) {
          throw new Error(
            `[rbac-enforcement] aliases of one handler disagree: "${first.key}" and "${other.key}" ` +
              'must declare the same capability, action, group and guard.',
          );
        }
      }

      entryByMethod.set(method, first);
    }

    // Step over role-string guards for capabilities this brick now owns.
    for (const layer of record.stack) {
      if (layer.handle && layer.handle.__rbacLegacyGuard && !layer.handle.__rbacBridged) {
        const bridged = new Map();
        for (const [method, entry] of entryByMethod.entries()) {
          if (entry.guard === GUARD.ROUTE && entry.group) bridged.set(method, entry.group);
        }
        if (bridged.size) {
          wrapLegacyGuard(layer, bridged);
          legacyGuardsWrapped += 1;
        }
      }
    }

    // Insert one guard per method that asks for a route-level check.
    const at = insertionIndex(record.stack);
    const toInsert = [];
    for (const [method, entry] of entryByMethod.entries()) {
      if (entry.guard !== GUARD.ROUTE) continue;
      toInsert.push(
        makeLayer(
          method,
          requireEffectivePermission({
            module: entry.module,
            submodule: entry.submodule,
            action: entry.action,
            group: entry.group,
            capability: entry.capability,
            route: entry.path,
          }),
        ),
      );
    }
    if (toInsert.length) {
      record.stack.splice(at, 0, ...toInsert);
      guardsInstalled += toInsert.length;
    }
  }

  const report = {
    routes: records.length,
    methodPaths,
    guardsInstalled,
    legacyGuardsWrapped,
    unclassified,
  };

  if (unclassified.length) {
    const message =
      `[rbac-enforcement] ${unclassified.length} registered route(s) have no manifest entry:\n  ` +
      unclassified.join('\n  ');
    if (options.throwOnUnclassified) throw new Error(message);
    logger.error('[rbac] unclassified routes', { count: unclassified.length, routes: unclassified });
  }

  logger.info('[rbac] route enforcement installed', {
    routes: report.routes,
    methodPaths: report.methodPaths,
    guardsInstalled: report.guardsInstalled,
    legacyGuardsWrapped: report.legacyGuardsWrapped,
    unclassified: unclassified.length,
    modes: config.getAllModes(),
    allLegacy: config.isEntirelyLegacy(),
  });

  return report;
}

module.exports = { installRouteEnforcement, insertionIndex, isAuthenticationLayer };
