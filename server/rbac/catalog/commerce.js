/**
 * Catalog data — PURCHASE and SALES.
 *
 * Verified against:
 *   server/routes/roles.js:40   `purchase` submodules
 *   server/routes/roles.js:58   `sales` submodules
 *   client/src/core/navigation/registry.js:76-92   sidebar rows
 *   client/src/core/navigation/registry.js:151-160 CREATE_ACTIONS (module-level `create`)
 *   client/src/modules/purchase/routes.js, client/src/modules/sales/routes.js
 *     — neither module declares a single requirePermission guard
 *   server/routes/vendors.js, purchaseNotes.js, expenses.js, invoices.js, customers.js
 */

'use strict';

const { defineEntry } = require('../catalogShared');

module.exports = [
  /* ── Purchase ──────────────────────────────────────────────────────────── */
  defineEntry({
    module: 'purchase', submodule: '',
    group: 'Purchase',
    label: 'Purchase (module access)',
    description: 'Legacy module-wide purchase baseline seeded with submodule = \'\'.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'MODULE_ACCESS',
    actions: ['view', 'create', 'edit', 'print'],
    emptySubmoduleMeaning: 'MODULE_ACCESS',
    enforcement: {
      // Sidebar "New Purchase Note" (editorOnly, no submodule) and the four
      // purchase CREATE_ACTIONS all resolve against purchase:''.
      navigation: 'ENFORCED',
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
      print: 'NOT_ENFORCED',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:81',
      'client/src/core/navigation/registry.js:154',
      'client/src/core/navigation/registry.js:155',
      'client/src/core/navigation/registry.js:156',
      'client/src/core/navigation/registry.js:158',
    ],
    backendRefs: ['server/migrations/phase35-rbac.sql:85'],
    notes: [
      'The Create menu gates Expense / Purchase Note / Vendor Bill / Vendor on the module-level CREATE bit, never on a submodule.',
    ],
  }),

  defineEntry({
    module: 'purchase', submodule: 'vendors',
    group: 'Purchase',
    subgroup: 'Master',
    label: 'Vendors',
    description: 'Vendor master list and vendor detail.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'delete'],
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'ROLE_STRING_ONLY',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:78',
      'client/src/modules/purchase/routes.js',
    ],
    backendRefs: ['server/routes/vendors.js'],
    notes: ['One authorize(\'admin\') guard exists in vendors.js; all other handlers are authenticate-only.'],
  }),

  defineEntry({
    module: 'purchase', submodule: 'purchase_notes',
    group: 'Purchase',
    subgroup: 'Documents',
    label: 'Purchase Notes & Vendor Bills',
    description: 'Purchase notes and vendor bills list, detail and creation.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'print'],
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
      print: 'NOT_ENFORCED',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:79',
      'client/src/core/navigation/registry.js:80',
    ],
    backendRefs: ['server/routes/purchaseNotes.js', 'server/routes/billTdsRoutes.js'],
    notes: ['One key serves both the Vendor Bills and Purchase Notes sidebar rows.'],
  }),

  defineEntry({
    module: 'purchase', submodule: 'new_purchase_note',
    group: 'Purchase',
    subgroup: 'Documents',
    label: 'New Purchase Note (legacy key)',
    description: 'Seeded key. The live "New Purchase Note" sidebar row resolves purchase:\'\' instead.',
    status: 'LEGACY_ORPHAN',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'create'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE', frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:44'],
    notes: ['Sidebar id `new-purchase-note` carries module `purchase` with NO submodule, so this row is never read.'],
  }),

  defineEntry({
    module: 'purchase', submodule: 'expenses',
    group: 'Purchase',
    subgroup: 'Documents',
    label: 'Expenses',
    description: 'Expense entry list and creation.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'print'],
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
      print: 'NOT_ENFORCED',
    },
    frontendRefs: ['client/src/core/navigation/registry.js:82'],
    backendRefs: ['server/routes/expenses.js', 'server/routes/expenseBills.js'],
  }),

  /* ── Sales ─────────────────────────────────────────────────────────────── */
  defineEntry({
    module: 'sales', submodule: '',
    group: 'Sales',
    label: 'Sales (module access)',
    description: 'Legacy module-wide sales baseline seeded with submodule = \'\'.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'MODULE_ACCESS',
    actions: ['view', 'create', 'edit', 'print'],
    emptySubmoduleMeaning: 'MODULE_ACCESS',
    enforcement: {
      // Sidebar "New Invoice" plus the Invoice/Customer CREATE_ACTIONS.
      navigation: 'ENFORCED',
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
      print: 'NOT_ENFORCED',
    },
    frontendRefs: [
      'client/src/core/navigation/registry.js:89',
      'client/src/core/navigation/registry.js:151',
      'client/src/core/navigation/registry.js:153',
    ],
    backendRefs: ['server/migrations/phase35-rbac.sql:86'],
  }),

  defineEntry({
    module: 'sales', submodule: 'invoice',
    group: 'Sales',
    subgroup: 'Documents',
    label: 'Invoices',
    description: 'Sales invoice list, detail and creation.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'print'],
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'AUTHENTICATE_ONLY',
      print: 'NOT_ENFORCED',
    },
    frontendRefs: ['client/src/core/navigation/registry.js:88'],
    backendRefs: ['server/routes/invoices.js'],
  }),

  defineEntry({
    module: 'sales', submodule: 'new_invoice',
    group: 'Sales',
    subgroup: 'Documents',
    label: 'New Invoice (legacy key)',
    description: 'Seeded key. The live "New Invoice" sidebar row resolves sales:\'\' instead.',
    status: 'LEGACY_ORPHAN',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'create'],
    enforcement: {
      navigation: 'NO_ACTIVE_FEATURE', frontend_route: 'NO_ACTIVE_FEATURE',
      frontend_action: 'NO_ACTIVE_FEATURE',
      api_list: 'NO_ACTIVE_FEATURE', api_detail: 'NO_ACTIVE_FEATURE',
      api_create: 'NO_ACTIVE_FEATURE', api_edit: 'NO_ACTIVE_FEATURE',
      api_delete: 'NO_ACTIVE_FEATURE',
    },
    backendRefs: ['server/routes/roles.js:62'],
    notes: ['Sidebar id `new-invoice` carries module `sales` with NO submodule, so this row is never read.'],
  }),

  defineEntry({
    module: 'sales', submodule: 'customers',
    group: 'Sales',
    subgroup: 'Master',
    label: 'Customers',
    description: 'Customer master list and customer detail.',
    status: 'ACTIVE',
    risk: 'HIGH',
    control: 'ACTION_MATRIX',
    actions: ['view', 'sidebar', 'create', 'edit', 'delete'],
    enforcement: {
      navigation: 'ENFORCED',
      frontend_route: 'NOT_ENFORCED',
      api_list: 'AUTHENTICATE_ONLY', api_detail: 'AUTHENTICATE_ONLY',
      api_create: 'AUTHENTICATE_ONLY', api_edit: 'AUTHENTICATE_ONLY',
      api_delete: 'ROLE_STRING_ONLY',
    },
    frontendRefs: ['client/src/core/navigation/registry.js:90'],
    backendRefs: ['server/routes/customers.js'],
    notes: ['One authorize(\'admin\') guard exists in customers.js; all other handlers are authenticate-only.'],
  }),
];
