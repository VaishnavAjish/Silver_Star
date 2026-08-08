/**
 * RBAC Brick 8 — the single reader of what Express actually registered.
 *
 * WHY THIS EXISTS RATHER THAN A GREP
 * ───────────────────────────────────
 * A grep over server/routes/ answers "what did somebody write", which is not the
 * question. The question is "what can a client reach", and only the built router
 * tree knows that. Three things in this application make the two differ:
 *
 *   - `app.use(['/api/journal', '/api/journal-entries', '/api/general-ledger'],
 *     journalRoutes)` publishes every handler under three prefixes. A file-level
 *     audit sees nine handlers; clients see twenty-seven paths.
 *   - `adminUsers` is mounted three times and `auth` twice, so the same Route
 *     object is reachable by several paths and must be classified once, not
 *     three times.
 *   - `masterFactory` builds routers at runtime; its forty-two endpoints exist
 *     in no route file at all.
 *
 * The installer and the coverage test both read from here, which is what makes
 * "every registered route is classified" a claim about reality instead of about
 * a list somebody maintained by hand.
 */

'use strict';

/**
 * Express 4 compiles a mount path with path-to-regexp `end:false`, producing
 * `^\/api\/foo\/?(?=\/|$)`. An array mount produces those alternatives joined by
 * `|`. Recovering the literal prefixes is therefore a matter of splitting on the
 * alternation and undoing the two decorations.
 *
 * Every mount in this application is a literal string, so no parameter groups
 * appear here. One is reported rather than guessed at if that ever changes.
 */
function mountPrefixesFrom(layer) {
  if (typeof layer.path === 'string') return [layer.path];
  if (Array.isArray(layer.path)) return layer.path.slice();

  const source = layer.regexp && layer.regexp.source;
  if (!source) return [''];
  if (source === '^\\/?(?=\\/|$)') return ['']; // app.use(fn) — no prefix

  // Split on the alternation BOUNDARY, not on every `|`. Each alternative is
  // anchored, so `|^` is the only real separator — a bare `|` also occurs inside
  // the `(?=\/|$)` lookahead that terminates every alternative.
  return source.split('|^').map((alternative, index) => {
    const anchored = index === 0 ? alternative : `^${alternative}`;
    const out = anchored
      .replace(/^\^/, '')
      .replace(/\\\/\?\(\?=\\\/\|\$\)$/, '')
      .replace(/\$$/, '')
      .replace(/\\\//g, '/');
    if (out.includes('(')) {
      throw new Error(
        '[rbac-route-introspection] mount path contains a parameter and cannot be ' +
          `reconstructed literally: ${source}`,
      );
    }
    return out;
  });
}

/** A route's own path may itself be a string or an array of strings. */
function routePathsFrom(route) {
  if (Array.isArray(route.path)) return route.path.slice();
  return [route.path];
}

function joinPath(prefix, routePath) {
  if (routePath === '/' || routePath === '') return prefix || '/';
  return `${prefix}${routePath}`;
}

/**
 * Enumerate every reachable route, once per Route object.
 *
 * @param {import('express').Express} app
 * @returns {Array<{route: object, methods: string[], paths: string[], stack: object[]}>}
 */
function collectRoutes(app) {
  const router = app._router || (app.router && app.router.stack ? app.router : null);
  if (!router || !router.stack) {
    throw new Error('[rbac-route-introspection] application has no router stack');
  }

  /** Route object → record. Identity is what makes multi-mount dedupe correct. */
  const byRoute = new Map();

  function walk(stack, prefixes) {
    for (const layer of stack) {
      if (layer.route) {
        const route = layer.route;
        let record = byRoute.get(route);
        if (!record) {
          record = {
            route,
            stack: route.stack,
            methods: Object.keys(route.methods)
              .filter((m) => m !== '_all')
              .map((m) => m.toUpperCase()),
            paths: [],
          };
          byRoute.set(route, record);
        }
        for (const prefix of prefixes) {
          for (const rp of routePathsFrom(route)) {
            const full = joinPath(prefix, rp);
            if (!record.paths.includes(full)) record.paths.push(full);
          }
        }
        continue;
      }

      // A sub-router. A bare middleware function has no `stack` own property,
      // so this test does not accidentally descend into one.
      if (layer.handle && Array.isArray(layer.handle.stack)) {
        const own = mountPrefixesFrom(layer);
        const nested = [];
        for (const prefix of prefixes) {
          for (const suffix of own) nested.push(`${prefix}${suffix}`);
        }
        walk(layer.handle.stack, nested);
      }
    }
  }

  walk(router.stack, ['']);
  return [...byRoute.values()];
}

/**
 * Flatten to one record per (method, path) — the shape the manifest is keyed by.
 *
 * @returns {Array<{method: string, path: string, record: object}>}
 */
function collectRouteKeys(app) {
  const out = [];
  for (const record of collectRoutes(app)) {
    for (const method of record.methods) {
      for (const path of record.paths) {
        out.push({ method, path, record });
      }
    }
  }
  return out;
}

/** Canonical manifest key. */
function keyOf(method, path) {
  return `${String(method).toUpperCase()} ${path}`;
}

module.exports = {
  collectRoutes,
  collectRouteKeys,
  keyOf,
  mountPrefixesFrom,
};
