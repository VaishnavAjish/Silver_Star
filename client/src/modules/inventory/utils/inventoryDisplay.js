// Inventory display contract — the single source of truth for how the
// All-Inventory table, CSV export and Print view render the three columns that
// used to be conflated: physical Location, functional Department, and the
// transaction Source (source_module).
//
// Backend (server/routes/inventory.js) exposes, per row:
//   - location_name       physical inventory Location (l.name)
//   - dept_name           functional Department       (d.name)
//   - dept_location_name  the Department's Location    (dl.name)
//   - source_module       transaction origin           (inv.source_module)
//
// Location must NEVER fall back to source_module. Source values such as
// "Growth Run", "Return from Process" or "Process Issues" belong only in the
// Source column.

export const LOCATION_COL   = { key: 'location_name', label: 'Location',        sortKey: 'location',      width: 130 };
export const DEPARTMENT_COL = { key: 'dept_name',     label: 'Department Name', sortKey: 'dept',          width: 120 };
export const SOURCE_COL     = { key: 'source_module', label: 'Source',          sortKey: 'source_module', width: 120 };

// Physical Location: real location, then the department's location, never the
// transaction source. Returns '' when no physical mapping exists yet.
export function resolveLocation(row) {
  return row.location_name || row.dept_location_name || '';
}

// Functional Department. Returns '' when unmapped.
export function resolveDepartment(row) {
  return row.dept_name || '';
}

// Transaction origin. source_module values are already stored human-readable
// (e.g. "Stock Transfer"); we only guarantee a leading capital. Returns ''
// when absent.
export function resolveSource(row) {
  const s = row.source_module;
  if (!s) return '';
  const str = String(s);
  return str.charAt(0).toUpperCase() + str.slice(1);
}
