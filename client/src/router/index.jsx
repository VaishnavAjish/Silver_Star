/**
 * Central application router.
 *
 * Architecture:
 *  - Every module owns its own routes.js (lazy imports + path config).
 *  - This file aggregates them, maps route configs → <Route> elements,
 *    and handles two special cases:
 *      1. Dynamic MASTER_CONFIGS routes that need a configKey prop.
 *      2. Admin-only routes wrapped in <AdminGuard>.
 *
 * Adding a new module: create modules/<name>/routes.js, import it here,
 * and spread it into allRouteConfigs. Nothing else changes.
 */

import { lazy, Suspense } from 'react';
import { Route } from 'react-router-dom';
import AdminGuard from '@shared/guards/AdminGuard';
import PermissionGuard from '@shared/guards/PermissionGuard';
import { MASTER_CONFIGS } from '@modules/management/pages/MasterConfigsData';

// ── Module route configs ──────────────────────────────────────────────────────
import dashboardRoutes     from '@modules/dashboard/routes';
import accountingRoutes    from '@modules/accounting/routes';
import inventoryRoutes     from '@modules/inventory/routes';
import purchaseRoutes      from '@modules/purchase/routes';
import roughRoutes         from '@modules/rough-diamonds/routes';
import salesRoutes         from '@modules/sales/routes';
import reportsRoutes       from '@modules/reports/routes';
import assetsRoutes        from '@modules/fixed-assets/routes';
import manufacturingRoutes from '@modules/manufacturing/routes';
import managementRoutes    from '@modules/management/routes';
import adminRoutes         from '@modules/admin-panel/routes';
import labelsRoutes        from '@modules/labels/routes';

// ── Lazy components used only in this file ────────────────────────────────────
// MasterPage receives a configKey prop, so it can't live in management/routes.js
export const LazyMasterPage    = lazy(() => import('@modules/management/pages/MasterPage'));
export const LazyClipboardPage = lazy(() => import('@/features/clipboard/ClipboardPage'));

// ── Page loading fallback ─────────────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="loading-screen">
      <div className="spinner" />
      <p>Loading...</p>
    </div>
  );
}

// ── Route config → JSX ───────────────────────────────────────────────────────
/**
 * Converts a route config object into a <Route> element.
 *
 * Config shape:
 *   { index?: true, path?: string, Component: LazyComponent,
 *     adminOnly?: bool, requirePermission?: { module, action } }
 */
function buildRoute({ index: isIndex, path, Component: C, adminOnly, requirePermission }) {
  const content = (
    <Suspense fallback={<PageLoader />}>
      <C />
    </Suspense>
  );

  let element = content;
  if (requirePermission) {
    element = <PermissionGuard module={requirePermission.module} action={requirePermission.action || 'view'}>{element}</PermissionGuard>;
  }
  if (adminOnly) {
    element = <AdminGuard>{element}</AdminGuard>;
  }

  return isIndex
    ? <Route key="__index" index element={element} />
    : <Route key={path} path={path} element={element} />;
}

// ── Aggregate all module routes ───────────────────────────────────────────────
const allRouteConfigs = [
  ...dashboardRoutes,
  ...accountingRoutes,
  ...inventoryRoutes,
  ...purchaseRoutes,
  ...roughRoutes,
  ...salesRoutes,
  ...reportsRoutes,
  ...assetsRoutes,
  ...manufacturingRoutes,
  ...managementRoutes,
  ...adminRoutes,
  ...labelsRoutes,
];

// ── Dynamic master-config routes (items, machines, departments, etc.) ─────────
const masterConfigRoutes = Object.keys(MASTER_CONFIGS).map(key => (
  <Route
    key={`master-${key}`}
    path={MASTER_CONFIGS[key].path}
    element={
      <Suspense fallback={<PageLoader />}>
        <LazyMasterPage configKey={key} />
      </Suspense>
    }
  />
));

// ── Exported route tree (spread directly into App's protected <Route>) ────────
export const appRoutes = [
  ...allRouteConfigs.map(buildRoute),
  ...masterConfigRoutes,
  <Route
    key="clipboard"
    path="clipboard"
    element={
      <Suspense fallback={<PageLoader />}>
        <LazyClipboardPage />
      </Suspense>
    }
  />,
];

// ── Tab system: resolve route path → lazy component ─────────────────────────
// Stable wrappers so each master-config path reuses the same component reference.
const MasterConfigWrappers = {};
for (const [key, cfg] of Object.entries(MASTER_CONFIGS)) {
  const Wrapper = (props) => <LazyMasterPage configKey={key} {...props} />;
  Wrapper.displayName = `MasterPage_${key}`;
  MasterConfigWrappers[cfg.path] = Wrapper;
}

/** Map of exact path (with leading /) → lazy component reference */
const exactMap = { '/': dashboardRoutes[0].Component };

for (const cfg of allRouteConfigs) {
  if (cfg.path && !cfg.path.includes(':')) {
    exactMap['/' + cfg.path] = cfg.Component;
  }
}
// Master config exact paths
for (const [key, cfg] of Object.entries(MASTER_CONFIGS)) {
  exactMap['/' + cfg.path] = MasterConfigWrappers[cfg.path];
}
// Clipboard
exactMap['/clipboard'] = LazyClipboardPage;

/** Ordered array of { pattern, paramNames, routePath, Component } for parameterized routes */
const paramPatterns = allRouteConfigs
  .filter(c => c.path && c.path.includes(':'))
  .map(c => {
    const paramNames = (c.path.match(/:[^/]+/g) || []).map(p => p.slice(1));
    const regexStr = '^/' + c.path.replace(/:[^/]+/g, '([^/]+)') + '$';
    return { pattern: new RegExp(regexStr), paramNames, routePath: '/' + c.path, Component: c.Component };
  });

/**
 * Given an actual URL path (e.g. "/vendors/5"), returns the matching lazy
 * component or null. Tries exact match first, then parameterised patterns.
 */
export function resolveRouteComponent(path) {
  if (exactMap[path]) return exactMap[path];
  for (const { pattern, Component } of paramPatterns) {
    if (pattern.test(path)) return Component;
  }
  return null;
}

/**
 * Given an actual URL path, returns { Component, params, routePath } or null.
 * params is the extracted key→value map (empty for exact/static routes).
 */
export function resolveRouteMatch(path) {
  if (exactMap[path]) return { Component: exactMap[path], params: {}, routePath: path };
  for (const { pattern, paramNames, routePath, Component } of paramPatterns) {
    const m = path.match(pattern);
    if (m) {
      const params = {};
      paramNames.forEach((name, i) => { params[name] = m[i + 1]; });
      return { Component, params, routePath };
    }
  }
  return null;
}
