/**
 * RBAC Brick 8 — route classification: Inventory, Inventory Management,
 * Lot Movements, lot corrections, Nidhi Connect, saved table templates.
 *
 * Rollout groups: `inventory`, `inventory_management`.
 *
 * TWO THINGS THAT LOOK LIKE ONE
 * ──────────────────────────────
 * `requireInventoryView` is on twenty-one of these routes and reads as a
 * permission gate. It is not one. Its `canViewInventory` is the literal
 * constant `true` (services/inventoryAuth.js:74) — every authenticated user
 * passes. What the middleware actually does is resolve DEPARTMENT SCOPE and
 * financial-field visibility, both of which stay exactly where they are.
 *
 * So the honest reading of today's inventory API is: any signed-in user can list
 * and read inventory, narrowed to their departments. Brick 8 adds the missing
 * half — whether they hold the capability at all — and changes nothing about the
 * narrowing.
 *
 * WHERE THE HANDLER ALREADY ASKS
 * ───────────────────────────────
 * Seed Stock, Gas Stock, weight corrections and history reversal already call
 * the canonical resolver inside the handler, with an action chosen from the
 * request. Those are marked GUARD.HANDLER: adding a route guard would either
 * duplicate the query or pick one action where the handler picks several.
 */

'use strict';

const { defineRoute, defineRoutes, STATUS, GUARD, LEGACY, AUTHORITY } = require('./defineRoute');

const SCOPE_NOTE =
  'Department scope and financial-field stripping continue to be applied by ' +
  'services/inventoryAuth.js. Brick 8 adds action permission only.';

const NO_BASELINE =
  'MISSING BASELINE (Brick 1): this capability has no seeded role_permissions row, so under ' +
  'STRICT only Super Admin passes until an administrator grants it. Resolve before enabling.';

module.exports = [
  /* ── Core inventory read surface ───────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    [
      '/api/inventory',
      '/api/inventory/filters/active',
      '/api/inventory/summary',
      '/api/inventory/by-category/:category',
      '/api/inventory/:id',
      '/api/inventory/:id/history',
      '/api/inventory/history/eligibility',
      '/api/inventory/history/union',
    ],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'inventory',
      module: 'inventory',
      submodule: 'all_inventory',
      action: 'view',
      legacy: LEGACY.INVENTORY_SCOPE,
      authority: AUTHORITY.IN_HANDLER,
      reason:
        'The inventory list and detail surface. Today requireInventoryView admits every ' +
        'authenticated user and only narrows rows by department; the all_inventory bitmask is ' +
        'never consulted.',
      notes: [SCOPE_NOTE, 'Detail reads answer 404 for out-of-scope lots — existence is not leaked.'],
    },
  ),

  defineRoute('PUT', '/api/inventory/edit/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory',
    module: 'inventory',
    submodule: 'all_inventory',
    action: 'edit',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason:
      'Direct lot edit. This is the widest gap in the inventory module: it is the only inventory ' +
      'route carrying neither a role guard NOR requireInventoryView, so today any authenticated ' +
      'user can edit any lot in any department.',
    notes: [
      'It receives no department scope either, because requireInventoryView is absent.',
      'STRICT closes the capability half. The scope half remains open and is recorded as a ' +
        'follow-up rather than changed here.',
    ],
  }),

  /* ── Lot movements and lineage ─────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    [
      '/api/lot-movements',
      '/api/lot-movements/:id',
      '/api/lot-movements/lineage/:lotId',
      '/api/inventory/:id/movement-ledger',
    ],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'inventory',
      module: 'inventory',
      submodule: 'lot_movements',
      action: 'view',
      legacy: LEGACY.INVENTORY_SCOPE,
      authority: AUTHORITY.IN_HANDLER,
      reason:
        'Movement history. Rows are already narrowed by buildMovementScopeClause, which requires a ' +
        'parent or child lot in an allowed department and fails closed.',
      notes: [SCOPE_NOTE],
    },
  ),

  defineRoute('POST', '/api/lot-movements/mix/preview', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory',
    module: 'inventory',
    submodule: 'mix_lots',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Computes the result of a mix without writing. VIEW is the right gate for a dry run.',
  }),
  defineRoute('POST', '/api/lot-movements/mix', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory',
    module: 'inventory',
    submodule: 'mix_lots',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Creates a mixed lot from parents. The Mix Lots capability owns this operation.',
  }),

  ...defineRoutes(['POST'], ['/api/lot-movements/split', '/api/lot-movements/split/preview'], {
    status: STATUS.SECURITY_BLOCKED,
    group: 'inventory',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Splitting a lot has no capability of its own in the Brick 1 catalog. inventory.mix_lots is ' +
      'labelled "Mix Lots" and covers combining, not dividing. Mapping Split onto it would grant ' +
      'split authority to everyone holding mix authority and vice versa — a permission change ' +
      'disguised as an enforcement change, which this brick is forbidden to make.',
    notes: [
      'Remains guarded by authorize("admin", "operator"), so it is not unguarded today.',
      'RECOMMENDED: add inventory.split_lots to the catalog, then reclassify.',
    ],
  }),

  /* ── Lot weight correction ─────────────────────────────────────────────── */

  defineRoute('POST', '/api/inventory/:id/corrections/weight', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory',
    guard: GUARD.HANDLER,
    module: 'inventory',
    submodule: 'inventory_correction',
    action: 'edit',
    legacy: LEGACY.EFFECTIVE_PERMISSION,
    reason:
      'services/inventoryCorrectionService.js:111 already resolves this exact capability before ' +
      'writing. A route guard would repeat the query for no added restriction.',
    notes: [NO_BASELINE],
  }),
  defineRoute('GET', '/api/inventory/:id/corrections', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory',
    module: 'inventory',
    submodule: 'inventory_correction',
    action: 'view',
    legacy: LEGACY.INVENTORY_SCOPE,
    reason: 'Correction history for one lot. VIEW gates the history read, EDIT the correction itself.',
    notes: [NO_BASELINE],
  }),

  /* ── History reversal ──────────────────────────────────────────────────── */

  defineRoute('POST', '/api/inventory/history/reverse', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory',
    guard: GUARD.HANDLER,
    module: 'inventory',
    submodule: 'history_reversal',
    action: 'edit',
    legacy: LEGACY.EFFECTIVE_PERMISSION,
    reason:
      'routes/inventory.js:976 already resolves inventory/edit/history_reversal. The capability is ' +
      'deliberately separate from ordinary inventory edit so that editing a lot never confers ' +
      'authority to reverse its history.',
    notes: [NO_BASELINE],
  }),

  /* ── Inventory Management: opening and closing ─────────────────────────── */

  ...defineRoutes(['GET'], ['/api/inventory/opening', '/api/inventory/opening/list'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory_management',
    module: 'inventory',
    submodule: 'opening_entry',
    action: 'view',
    legacy: LEGACY.INVENTORY_SCOPE,
    reason: 'Opening-stock entries.',
    notes: [SCOPE_NOTE],
  }),
  defineRoute('POST', '/api/inventory/opening', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory_management',
    module: 'inventory',
    submodule: 'opening_entry',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Creates opening stock — the entry point for inventory quantities.',
  }),
  defineRoute('GET', '/api/inventory/closing', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory_management',
    module: 'inventory',
    submodule: 'closing_entry',
    action: 'view',
    legacy: LEGACY.INVENTORY_SCOPE,
    reason: 'Closing-stock entries.',
    notes: [SCOPE_NOTE],
  }),
  defineRoute('POST', '/api/inventory/closing', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory_management',
    module: 'inventory',
    submodule: 'closing_entry',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Creates closing stock, which freezes a period.',
  }),

  /* ── Inventory Management: seed and gas stock ──────────────────────────── */

  ...defineRoutes(['GET'], ['/api/inventory/seed-stock', '/api/inventory/seed-stock/lots'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory_management',
    guard: GUARD.HANDLER,
    module: 'inventory',
    submodule: 'seed_stock',
    action: 'view',
    legacy: LEGACY.EFFECTIVE_PERMISSION,
    reason:
      'routes/inventory.js:1050 resolves inventory/<action>/seed_stock with the action derived from ' +
      'the request, so the handler already covers view, export and print from one place.',
  }),
  defineRoute('GET', '/api/inventory/seed-stock/export', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory_management',
    guard: GUARD.HANDLER,
    module: 'inventory',
    submodule: 'seed_stock',
    action: 'export',
    legacy: LEGACY.EFFECTIVE_PERMISSION,
    reason:
      'Same handler-side resolution, with the action switching to export or print from the format ' +
      'query parameter. A fixed route guard could not express that.',
  }),
  ...defineRoutes(['GET'], ['/api/inventory/gas-stock', '/api/inventory/gas-stock/lots'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory_management',
    guard: GUARD.HANDLER,
    module: 'inventory',
    submodule: 'gas_stock',
    action: 'view',
    legacy: LEGACY.EFFECTIVE_PERMISSION,
    reason: 'routes/inventory.js:1082 resolves inventory/<action>/gas_stock from the request.',
  }),
  defineRoute('GET', '/api/inventory/gas-stock/export', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory_management',
    guard: GUARD.HANDLER,
    module: 'inventory',
    submodule: 'gas_stock',
    action: 'export',
    legacy: LEGACY.EFFECTIVE_PERMISSION,
    reason: 'Handler-side action selection, as for Seed Stock export.',
  }),

  /* ── Nidhi Connect ─────────────────────────────────────────────────────── */

  defineRoute('GET', '/api/nidhi-connect/lots', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory',
    module: 'inventory',
    submodule: 'all_inventory',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Lists inventory lots through the Nidhi Connect bridge; the data is inventory data.',
  }),
  defineRoute('POST', '/api/nidhi-connect/lots/:id/correct-name', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'inventory',
    module: 'inventory',
    submodule: 'inventory_correction',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Rewrites a lot identity string. That is a lot correction, and the correction capability is ' +
      'the one already used by the weight-correction path.',
    notes: [NO_BASELINE],
  }),
  defineRoute('POST', '/api/nidhi-connect/batches/:id/reopen', {
    status: STATUS.SECURITY_BLOCKED,
    group: 'inventory',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Reopening a closed Nidhi Connect batch is a lifecycle reversal with no catalog capability. ' +
      'It is neither a lot correction nor an inventory edit, and inventing a mapping would be a ' +
      'permission decision this brick may not take.',
    notes: ['Remains guarded by authorize("admin", "super_admin").'],
  }),

  /* ── Saved inventory table templates ───────────────────────────────────── */

  ...defineRoutes(['GET', 'POST'], ['/api/inventory-templates'], {
    status: STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    group: 'inventory',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    authority: AUTHORITY.IN_HANDLER,
    reason:
      'Column and filter layouts the user saves for themselves. They hold no inventory data — only ' +
      'column names and filter values — and the handler restricts global templates to admin.',
  }),
  ...defineRoutes(['PUT', 'DELETE'], ['/api/inventory-templates/:id'], {
    status: STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    group: 'inventory',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    authority: AUTHORITY.IN_HANDLER,
    reason:
      'Ownership is enforced in-handler: a template may only be changed by its creator, or by ' +
      'superadmin (routes/inventoryTemplates.js:88, :125).',
    notes: [
      'The ownership check spells the role "superadmin" while other paths use "super_admin". Both ' +
        'normalise to Super Admin elsewhere; recorded, not changed.',
    ],
  }),
  defineRoute('POST', '/api/inventory-templates/:id/share', {
    status: STATUS.INTENTIONALLY_AUTHENTICATED_ONLY,
    group: 'inventory',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    authority: AUTHORITY.IN_HANDLER,
    reason: 'Shares a layout the caller owns with named users. Carries no inventory data.',
  }),
];
