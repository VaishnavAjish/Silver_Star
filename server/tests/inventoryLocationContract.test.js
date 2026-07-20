// Inventory Location/Source contract — static source assertions (no DB needed).
// Proves the Location filter list and filter application never touch
// source_module, that CSV/Print reuse the same display resolvers as the table,
// and that unrelated filters are untouched. Run with `node --test`.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const serverRoot = path.join(__dirname, '..');
const clientRoot = path.join(serverRoot, '..', 'client', 'src');
const read = p => fs.readFileSync(p, 'utf8');

const inventoryRouteSrc = read(path.join(serverRoot, 'routes', 'inventory.js'));
const invPageSrc = read(path.join(clientRoot, 'modules', 'inventory', 'pages', 'InventoryPage.jsx'));
const displaySrc = read(path.join(clientRoot, 'modules', 'inventory', 'utils', 'inventoryDisplay.js'));

// Isolate the /filters/active handler body.
function filtersActiveBlock() {
  const start = inventoryRouteSrc.indexOf("'/filters/active'");
  assert.ok(start > -1, 'filters/active route must exist');
  const end = inventoryRouteSrc.indexOf('// GET /api/inventory/opening/list', start);
  return inventoryRouteSrc.slice(start, end > -1 ? end : undefined);
}

// Isolate the location_id filter-apply block.
function locationApplyBlock() {
  const start = inventoryRouteSrc.indexOf('if (req.query.location_id');
  assert.ok(start > -1, 'location_id filter apply must exist');
  return inventoryRouteSrc.slice(start, start + 800);
}

// ── 9. Location filter list contains only real Location Master values ─────────
test('9. Location filter list selects only from the locations table (no source_module UNION)', () => {
  const block = filtersActiveBlock();
  // The locations list is the first pool.query template literal in the handler.
  const qStart = block.indexOf('pool.query(`');
  assert.ok(qStart > -1, 'filters/active must issue a pool.query');
  const locQuery = block.slice(qStart, block.indexOf('`)', qStart));
  assert.ok(/FROM locations/.test(locQuery), 'must query the locations master table');
  assert.ok(!/UNION/i.test(locQuery), 'Location list must not UNION anything');
  assert.ok(!/source_module/.test(locQuery), 'Location list must not include source_module');
});

// ── 10. Location filtering never applies source_module ────────────────────────
test('10. Location filter apply matches location ids only, never source_module', () => {
  const block = locationApplyBlock();
  assert.ok(!/inv\.source_module/.test(block), 'location filter must not match on inv.source_module');
  assert.ok(!block.includes('source_module = $'), 'location filter must not bind source_module as a param');
  assert.ok(/inv\.location_id\s*=\s*\$/.test(block), 'must match on inv.location_id');
  assert.ok(/d\.location_id\s*=\s*\$/.test(block), "must fall back to the department's location_id");
});

// ── 11. CSV/Print mappings match the UI (same resolvers) ──────────────────────
test('11. CSV/Print export uses the same display resolvers as the table', () => {
  // The export builder must delegate the three columns to the shared resolvers.
  assert.ok(/col\.key === 'location_name'\)\s*return resolveLocation\(row\)/.test(invPageSrc),
    'CSV must resolve Location via resolveLocation');
  assert.ok(/col\.key === 'dept_name'\)\s*return resolveDepartment\(row\)/.test(invPageSrc),
    'CSV must resolve Department via resolveDepartment');
  assert.ok(/col\.key === 'source_module'\)\s*return resolveSource\(row\)/.test(invPageSrc),
    'CSV must resolve Source via resolveSource');
  // Both the table render and CSV import from the single source of truth.
  assert.ok(/from '\.\.\/utils\/inventoryDisplay'/.test(invPageSrc),
    'InventoryPage must import the shared display module');
  // Location resolver structurally cannot return source_module.
  assert.ok(!/source_module/.test(
    displaySrc.slice(displaySrc.indexOf('function resolveLocation'), displaySrc.indexOf('function resolveDepartment'))
  ), 'resolveLocation must not reference source_module');
});

// ── 12. Existing search/status/process filters remain unchanged ───────────────
test('12. Unrelated filters (search, status, process_type, operation_type) are intact', () => {
  assert.ok(inventoryRouteSrc.includes('inv.status = $'), 'status filter intact');
  assert.ok(inventoryRouteSrc.includes('COALESCE(mp.process_type, lpi.process_type) = $'),
    'process_type filter intact');
  assert.ok(inventoryRouteSrc.includes('inv.operation_type = $'), 'operation_type filter intact');
  assert.ok(inventoryRouteSrc.includes('inv.lot_number ILIKE'), 'search filter intact');
  // account_base_id (Department filter) still matches the department's location.
  const acctIdx = inventoryRouteSrc.indexOf('account_base_id');
  assert.ok(acctIdx > -1 && inventoryRouteSrc.slice(acctIdx, acctIdx + 160).includes('d.location_id = $'),
    'Department (account_base_id) filter intact');
});
