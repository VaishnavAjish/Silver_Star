/**
 * RBAC Brick 8 — route classification: Purchase and Sales.
 *
 * Rollout groups: `purchase`, `sales` (plus one `accounting`-group quick-create
 * endpoint that lives here because it belongs to the same three-endpoint
 * router).
 *
 * "CATALOG-SUPPORTED ACTIONS ONLY" HAS TEETH HERE
 * ────────────────────────────────────────────────
 * `purchase.expenses` supports view / sidebar / create / edit / print. It does
 * NOT support delete. But DELETE /api/expense-bills/:id exists and is live.
 * There is no honest mapping: using `edit` for a delete would let anybody who
 * can amend an expense bill destroy one, which is a permission decision, and
 * `delete` is not an action this capability declares. It is therefore
 * SECURITY_BLOCKED and keeps its role-string guard. defineRoute would have
 * thrown had it been mapped anyway — that check is why the gap surfaced.
 */

'use strict';

const { defineRoute, defineRoutes, STATUS, LEGACY } = require('./defineRoute');

const PURCHASE_ALIASES = ['/api/purchase', '/api/purchase-notes'];
const SALES_ALIASES = ['/api/sales', '/api/invoices'];

module.exports = [
  /* ── Purchase notes ────────────────────────────────────────────────────── */

  ...defineRoutes(['GET'], PURCHASE_ALIASES, {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'purchase',
    module: 'purchase',
    submodule: 'purchase_notes',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Purchase note list.',
  }),
  ...defineRoutes(['GET'], PURCHASE_ALIASES.map((p) => `${p}/:id`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'purchase',
    module: 'purchase',
    submodule: 'purchase_notes',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Purchase note detail, including line items and vendor pricing.',
  }),
  ...defineRoutes(['GET'], PURCHASE_ALIASES.map((p) => `${p}/debug`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'purchase',
    module: 'purchase',
    submodule: 'purchase_notes',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason:
      'A diagnostic that returns purchase-note data, so it is gated as a read rather than left ' +
      'outside the model.',
    notes: [
      'It declares no route-level authenticate; only the global /api gate covers it.',
      'RECOMMENDED: remove the endpoint.',
    ],
  }),
  ...defineRoutes(['POST'], PURCHASE_ALIASES, {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'purchase',
    module: 'purchase',
    submodule: 'purchase_notes',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Creates a purchase note, which posts inventory and payable entries.',
  }),
  ...defineRoutes(['PUT'], PURCHASE_ALIASES.map((p) => `${p}/:id`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'purchase',
    module: 'purchase',
    submodule: 'purchase_notes',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Edits a purchase note.',
    notes: [
      'Guarded today by authorize("admin", "super_admin") — narrower than the operator access ' +
        'granted on creation. STRICT replaces both with the purchase_notes EDIT bit.',
    ],
  }),

  /* ── Purchase note TDS ─────────────────────────────────────────────────── */

  defineRoute('GET', '/api/purchase-notes/:id/tds', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'purchase',
    module: 'purchase',
    submodule: 'purchase_notes',
    action: 'view',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Reads the TDS deduction recorded against a purchase note.',
  }),
  ...defineRoutes(['POST', 'PUT'], ['/api/purchase-notes/:id/tds'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'purchase',
    module: 'purchase',
    submodule: 'purchase_notes',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Records or amends TDS on a purchase note. Mapped to the purchase note it amends rather than ' +
      'to a journal capability, because the note is the business object being changed.',
    notes: [
      'It does post journal entries as a side effect. Recorded so the accounting owner can decide ' +
        'whether accounting.journal_entries EDIT should also be required.',
      'Guarded today by authorize("admin", "accountant"). "accountant" appears in no ROLE_DEFAULTS ' +
        'entry, so that arm may already be dead.',
    ],
  }),
  defineRoute('POST', '/api/purchase-notes/:id/tds/reverse', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'purchase',
    module: 'purchase',
    submodule: 'purchase_notes',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Reverses a TDS deduction by posting a contra entry. Same capability as recording it — the ' +
      'reversal is an amendment of the same note.',
  }),

  /* ── Vendors ───────────────────────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    [
      '/api/vendors',
      '/api/vendors/summary',
      '/api/vendors/:id',
      '/api/vendors/:id/transactions',
      '/api/vendors/:id/open-bills',
    ],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'purchase',
      module: 'purchase',
      submodule: 'vendors',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason:
        'Vendor master and vendor account activity. /summary and /:id/transactions expose balances ' +
        'and payment history, so they are gated with the list rather than left open.',
    },
  ),
  ...defineRoutes(['POST'], ['/api/vendors', '/api/vendors/bulk-upload'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'purchase',
    module: 'purchase',
    submodule: 'vendors',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Creates vendors, singly or by upload.',
  }),
  defineRoute('PUT', '/api/vendors/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'purchase',
    module: 'purchase',
    submodule: 'vendors',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Edits a vendor, including bank details used for payment.',
  }),
  defineRoute('DELETE', '/api/vendors/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'purchase',
    module: 'purchase',
    submodule: 'vendors',
    action: 'delete',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Deletes a vendor.',
  }),

  /* ── Expenses ──────────────────────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    ['/api/expenses', '/api/expenses/:id', '/api/expense-bills', '/api/expense-bills/:id'],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'purchase',
      module: 'purchase',
      submodule: 'expenses',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason: 'Expense and expense-bill records.',
    },
  ),
  ...defineRoutes(['POST'], ['/api/expenses', '/api/expense-bills'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'purchase',
    module: 'purchase',
    submodule: 'expenses',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Records an expense or expense bill, posting to the expense ledger.',
  }),
  defineRoute('PUT', '/api/expense-bills/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'purchase',
    module: 'purchase',
    submodule: 'expenses',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Amends an expense bill.',
  }),
  defineRoute('DELETE', '/api/expense-bills/:id', {
    status: STATUS.SECURITY_BLOCKED,
    group: 'purchase',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'purchase.expenses declares view / sidebar / create / edit / print and no delete action. ' +
      'Mapping this onto EDIT would silently grant destruction to everyone holding amendment ' +
      'rights; adding a delete action to the capability would be a permission change. Neither is ' +
      'available to an enforcement brick.',
    notes: [
      'Remains guarded by authorize("admin", "operator").',
      'RECOMMENDED: add `delete` to purchase.expenses in the catalog, then reclassify.',
    ],
  }),

  /* ── Sales invoices ────────────────────────────────────────────────────── */

  ...defineRoutes(['GET'], SALES_ALIASES, {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'sales',
    module: 'sales',
    submodule: 'invoice',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Invoice list.',
  }),
  ...defineRoutes(['GET'], SALES_ALIASES.map((p) => `${p}/:id`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'sales',
    module: 'sales',
    submodule: 'invoice',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Invoice detail, including pricing and customer terms.',
  }),
  ...defineRoutes(['POST'], SALES_ALIASES, {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'sales',
    module: 'sales',
    submodule: 'invoice',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Raises an invoice, posting revenue and a receivable.',
  }),

  /* ── Customers ─────────────────────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    [
      '/api/customers',
      '/api/customers/summary',
      '/api/customers/:id',
      '/api/customers/:id/transactions',
      '/api/customers/:id/open-invoices',
    ],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'sales',
      module: 'sales',
      submodule: 'customers',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason: 'Customer master plus outstanding balances and payment history.',
    },
  ),
  defineRoute('POST', '/api/customers', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'sales',
    module: 'sales',
    submodule: 'customers',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Creates a customer.',
  }),
  defineRoute('PUT', '/api/customers/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'sales',
    module: 'sales',
    submodule: 'customers',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Edits a customer, including credit terms.',
  }),
  defineRoute('DELETE', '/api/customers/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'sales',
    module: 'sales',
    submodule: 'customers',
    action: 'delete',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Deletes a customer.',
  }),

  /* ── Quick create ──────────────────────────────────────────────────────── */

  defineRoute('POST', '/api/quick-create/vendors', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'purchase',
    module: 'purchase',
    submodule: 'vendors',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'The inline "create vendor" affordance inside other forms. Same authority as the full vendor ' +
      'form — a shortcut must not be a way around the capability.',
  }),
  defineRoute('POST', '/api/quick-create/customers', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'sales',
    module: 'sales',
    submodule: 'customers',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Inline customer creation. Same authority as the full customer form.',
  }),
  defineRoute('POST', '/api/quick-create/accounts', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'chart_of_accounts',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Inline creation of a general-ledger account. Same authority as the Chart of Accounts form; ' +
      'the shortcut must not bypass it.',
  }),
];
