/**
 * RBAC Brick 1 — read-only canonical permission catalog endpoint.
 *
 *   GET /api/admin/permission-catalog
 *   GET /api/admin/permission-catalog/diagnostics
 *
 * STRICTLY READ-ONLY. No POST/PUT/PATCH/DELETE exists here and none may be
 * added: this brick must not become a second way to change permissions.
 *
 * Guarded by the SAME admin guard the rest of the admin panel uses
 * (authenticate + authorize('admin'); super_admin passes inside authorize).
 *
 * Source file paths are omitted by default and returned only when an admin
 * explicitly asks for them with ?include_refs=1.
 */

'use strict';

const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logger } = require('../middleware/logger');
const catalog = require('../rbac/permissionCatalog');
const analysis = require('../rbac/catalogAnalysis');

const router = express.Router();
const adminOnly = [authenticate, authorize('admin')];

const truthy = v => v === '1' || v === 'true';

/** Drop implementation references unless the caller opted in. */
function projectEntry(entry, includeRefs) {
  if (includeRefs) return entry;
  const { frontend_refs: _frontendRefs, backend_refs: _backendRefs, ...rest } = entry;
  return rest;
}

/**
 * Read every active role baseline. Read-only, and deliberately non-fatal:
 * when the database is unreachable the catalog still serves its static half.
 */
async function loadRoleBaselines() {
  const { rows } = await pool.query(
    `SELECT r.slug AS role_slug, rp.module, rp.submodule, rp.permissions
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
      WHERE r.is_active = TRUE`
  );
  return rows;
}

/** Static anomalies plus, when reachable, the role-baseline anomalies. */
async function collectAnomalies(context) {
  const anomalies = [...analysis.analyzeStatic()];
  let source = 'database';
  let rowCount = 0;
  try {
    const rows = await loadRoleBaselines();
    rowCount = rows.length;
    anomalies.push(...analysis.analyzeRoleBaselines(rows));
  } catch (err) {
    source = 'unavailable';
    logger.warn(`${context}: role baselines unavailable`, { error: err.message });
  }
  return { anomalies, role_baseline: { source, role_permission_rows: rowCount } };
}

/* ── GET /api/admin/permission-catalog ─────────────────────────────────────── */
router.get('/', ...adminOnly, async (req, res) => {
  try {
    const includeRefs = truthy(req.query.include_refs);
    const includeInactive = req.query.include_inactive === undefined
      ? true
      : truthy(req.query.include_inactive);

    const permissions = catalog.PERMISSIONS
      .filter(p => includeInactive || p.status === 'ACTIVE')
      .map(p => projectEntry(p, includeRefs));

    const { anomalies, role_baseline: roleBaseline } =
      await collectAnomalies('permission-catalog');

    res.json({
      version:      catalog.CATALOG_VERSION,
      generated_at: new Date().toISOString(),
      groups:       catalog.getGroups(),
      permissions,
      view_restrictions:   catalog.VIEW_RESTRICTIONS,
      anomalies,
      enforcement_summary: catalog.getEnforcementSummary(),
      totals:              catalog.getTotals(),
      duplicates:          catalog.getDuplicateMap(),
      role_baseline:       roleBaseline,
    });
  } catch (err) {
    logger.error('GET permission-catalog error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Server error' });
  }
});

/* ── GET /api/admin/permission-catalog/diagnostics ─────────────────────────
 * The Brick 1 admin diagnostic view. This is NOT the future permission editor.
 */
router.get('/diagnostics', ...adminOnly, async (req, res) => {
  try {
    const includeRefs = truthy(req.query.include_refs);
    const mapping = analysis.analyzeMapping();
    const { anomalies, role_baseline: roleBaseline } =
      await collectAnomalies('permission-catalog diagnostics');

    const byType = {};
    const bySeverity = {};
    for (const a of anomalies) {
      byType[a.type] = (byType[a.type] || 0) + 1;
      bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1;
    }

    const totals = catalog.getTotals();
    const asKeys = list => list.map(r => `${r.module}:${r.submodule}`);

    res.json({
      version:      catalog.CATALOG_VERSION,
      generated_at: new Date().toISOString(),
      counts: {
        total_permissions:     totals.total,
        by_status:             totals.by_status,
        module_access_entries: totals.module_access_entries.length,
        missing_baseline_rows: totals.missing_baseline_rows.length,
        view_restrictions:     catalog.VIEW_RESTRICTIONS.length,
        unenforced_view_restrictions:
          catalog.VIEW_RESTRICTIONS.filter(v => v.status === 'STORED_NOT_ENFORCED').length,
      },
      mapping: includeRefs ? mapping : {
        ...mapping,
        unmapped_sidebar:        asKeys(mapping.unmapped_sidebar),
        unmapped_route_guards:   asKeys(mapping.unmapped_route_guards),
        unmapped_backend_guards: asKeys(mapping.unmapped_backend_guards),
        unmapped_server_tree:    asKeys(mapping.unmapped_server_tree),
        unmapped_client_tree:    asKeys(mapping.unmapped_client_tree),
      },
      duplicates:          catalog.getDuplicateMap(),
      enforcement_summary: catalog.getEnforcementSummary(),
      anomaly_counts: { by_type: byType, by_severity: bySeverity, total: anomalies.length },
      anomalies,
      role_baseline: roleBaseline,
    });
  } catch (err) {
    logger.error('GET permission-catalog diagnostics error', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
