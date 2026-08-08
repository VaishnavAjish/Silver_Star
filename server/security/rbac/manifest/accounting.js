/**
 * RBAC Brick 8 — route classification: Accounting.
 *
 * Rollout group: `accounting`.
 *
 * SCOPE FENCE — READ THIS BEFORE CHANGING ANYTHING HERE
 * ──────────────────────────────────────────────────────
 * This file answers WHO may call an accounting operation. It says nothing about
 * WHAT the operation does. The known transaction deletion/reversal integrity
 * problem is a separate, still-open defect: commit 87b5d80 blocks deletion of
 * posted or system-generated journal entries and 73f8057 adds a canonical
 * payment reversal service, but the wider orchestration question is not settled.
 *
 * ACCOUNTING DELETE INTEGRITY ISSUE REMAINS OPEN. Brick 8 does not touch it.
 *
 * REVERSAL IS MAPPED TO DELETE, NOT EDIT
 * ───────────────────────────────────────
 * `accounting.journal_entries` supports delete; reversing a posted entry is the
 * sanctioned way to undo one, since true deletion is now blocked for posted
 * entries. Mapping reversal onto EDIT would mean everyone who can amend a draft
 * can also unwind a posted entry, which is a wider grant than exists today.
 * DELETE is the narrower and more honest fit.
 *
 * WHERE THE CATALOG HAS NO DELETE, NOTHING IS INVENTED
 * ────────────────────────────────────────────────────
 * `accounting.bank_deposits` and `accounting.transfers` declare no delete
 * action, yet both have live DELETE endpoints. Those are SECURITY_BLOCKED rather
 * than folded into EDIT.
 */

'use strict';

const { defineRoute, defineRoutes, STATUS, LEGACY } = require('./defineRoute');

const JOURNAL_ALIASES = ['/api/journal', '/api/journal-entries', '/api/general-ledger'];

const COST_CENTRE_NO_BASELINE =
  'MISSING BASELINE (Brick 1): management.cost_centres has no seeded role_permissions row in any ' +
  'namespace, so under STRICT only Super Admin passes. This must be granted before the accounting ' +
  'group leaves SHADOW.';

module.exports = [
  /* ── Chart of accounts ─────────────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    ['/api/accounts', '/api/accounts/tree', '/api/accounts/search', '/api/accounts/:id'],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'accounting',
      module: 'accounting',
      submodule: 'chart_of_accounts',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason:
        'Account list, hierarchy, search and detail. /search is included deliberately: an ' +
        'autocomplete that answers from the same table is the same read.',
    },
  ),
  defineRoute('POST', '/api/accounts', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'chart_of_accounts',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Adds a general-ledger account.',
  }),
  defineRoute('PUT', '/api/accounts/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'chart_of_accounts',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Edits an account, including its type and parent.',
  }),
  defineRoute('DELETE', '/api/accounts/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'chart_of_accounts',
    action: 'delete',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Deletes an account.',
  }),

  /* ── Journal entries ───────────────────────────────────────────────────── */

  ...defineRoutes(['GET'], JOURNAL_ALIASES, {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'journal_entries',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Journal list. Published under three prefixes; each is separately reachable.',
  }),
  ...defineRoutes(['GET'], JOURNAL_ALIASES.map((p) => `${p}/:id`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'journal_entries',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Journal entry detail with its lines.',
  }),
  ...defineRoutes(['GET'], JOURNAL_ALIASES.map((p) => `${p}/ledger/:accountId`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'journal_entries',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'The ledger view for one account — the same postings, grouped differently.',
  }),
  ...defineRoutes(['POST'], JOURNAL_ALIASES, {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'journal_entries',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Creates a journal entry.',
  }),
  ...defineRoutes(['PUT'], JOURNAL_ALIASES.map((p) => `${p}/:id`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'journal_entries',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Amends a journal entry.',
    notes: [
      'Guarded today by authorize("admin", "operator", "finance"). "finance" appears in no ' +
        'ROLE_DEFAULTS entry, so that arm may already be dead.',
    ],
  }),
  ...defineRoutes(['PUT'], JOURNAL_ALIASES.map((p) => `${p}/:id/post`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'journal_entries',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Posting moves an entry from draft to permanent. accounting.journal_entries declares no ' +
      'approve action, so EDIT is the closest catalog-supported fit.',
    notes: [
      'OPEN: posting is arguably an approval and would be better served by a dedicated action. ' +
        'Adding one is a permission change and is out of scope here.',
    ],
  }),
  ...defineRoutes(['POST'], JOURNAL_ALIASES.map((p) => `${p}/:id/reverse`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'journal_entries',
    action: 'delete',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Reversal is the sanctioned way to unwind a posted entry now that deletion of posted entries ' +
      'is blocked. DELETE authority, not EDIT: undoing a posted entry must not follow from being ' +
      'able to amend a draft one.',
    notes: ['ACCOUNTING DELETE INTEGRITY ISSUE REMAINS OPEN — only authorization is addressed here.'],
  }),
  ...defineRoutes(['DELETE'], JOURNAL_ALIASES.map((p) => `${p}/:id`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'journal_entries',
    action: 'delete',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Deletes a journal entry.',
    notes: [
      'PRESERVED: commit 87b5d80 blocks deletion of posted or system-generated entries inside the ' +
        'handler. That check runs after this guard and is untouched.',
      'ACCOUNTING DELETE INTEGRITY ISSUE REMAINS OPEN.',
    ],
  }),

  /* ── Journal entry allocations ─────────────────────────────────────────── */

  defineRoute('GET', '/api/je-allocations', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'journal_entries',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Reads how a journal entry is allocated across cost centres.',
  }),
  defineRoute('POST', '/api/je-allocations', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'journal_entries',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Allocates an existing entry — an amendment of that entry, not a new posting.',
  }),
  ...defineRoutes(['DELETE'], ['/api/je-allocations/:id', '/api/je-allocations/by-je/:je_id'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'journal_entries',
    action: 'delete',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Removes allocations, singly or for a whole entry.',
  }),

  /* ── Payments ──────────────────────────────────────────────────────────── */

  ...defineRoutes(['GET'], ['/api/payments', '/api/payments/open', '/api/payments/:id/allocation'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'payments',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Payment list, open payments and per-payment allocation detail.',
  }),
  defineRoute('POST', '/api/payments', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'payments',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Records a payment — money leaving the business.',
  }),
  defineRoute('POST', '/api/payments/:id/reverse', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'payments',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'accounting.payments declares no delete action, so EDIT is the only catalog-supported fit for ' +
      'the reversal added by commit 73f8057.',
    notes: [
      'OPEN: unlike journal entries, payments have no delete action to express reversal authority ' +
        'separately from amendment. Recorded rather than resolved by adding one.',
      'Guarded today by authorize("admin", "finance").',
    ],
  }),

  /* ── Receipts ──────────────────────────────────────────────────────────── */

  ...defineRoutes(['GET'], ['/api/receipts', '/api/receipts/open'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'receipts',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Receipt list and open receipts.',
  }),
  defineRoute('POST', '/api/receipts', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'receipts',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Records a receipt — money entering the business.',
  }),

  /* ── Bank deposits ─────────────────────────────────────────────────────── */

  ...defineRoutes(['GET'], ['/api/bank-deposits', '/api/bank-deposits/:id'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'bank_deposits',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Bank deposit list and detail.',
  }),
  defineRoute('POST', '/api/bank-deposits', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'bank_deposits',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Records a deposit.',
  }),
  defineRoute('PUT', '/api/bank-deposits/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'bank_deposits',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Amends a deposit.',
  }),
  defineRoute('POST', '/api/bank-deposits/:id/reverse', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'bank_deposits',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Reverses a deposit. accounting.bank_deposits declares no delete action.',
  }),
  defineRoute('DELETE', '/api/bank-deposits/:id', {
    status: STATUS.SECURITY_BLOCKED,
    group: 'accounting',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'A live DELETE against a capability that declares no delete action. Folding it into EDIT ' +
      'would let anyone who can amend a deposit destroy one; adding the action would be a ' +
      'permission change.',
    notes: [
      'Remains guarded by authorize("admin").',
      'ACCOUNTING DELETE INTEGRITY ISSUE REMAINS OPEN — this endpoint belongs to that review.',
    ],
  }),

  /* ── Bank reconciliation ───────────────────────────────────────────────── */

  ...defineRoutes(['GET'], ['/api/bank-recon', '/api/bank-recon/system', '/api/bank-recon/:id'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'bank_reconciliation',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Reconciliation worksheets and system-side transactions.',
  }),
  ...defineRoutes(
    ['POST'],
    ['/api/bank-recon/upload', '/api/bank-recon/auto-match', '/api/bank-recon/save'],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'accounting',
      module: 'accounting',
      submodule: 'bank_reconciliation',
      action: 'edit',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason:
        'Statement upload, automatic matching and saving a reconciliation. All three write ' +
        'reconciliation state and were authenticate-only.',
    },
  ),

  /* ── Fund transfers ────────────────────────────────────────────────────── */

  ...defineRoutes(['GET'], ['/api/transfers', '/api/transfers/:id'], {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'transfers',
    action: 'view',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Fund transfer list and detail.',
  }),
  defineRoute('POST', '/api/transfers', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'accounting',
    submodule: 'transfers',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Moves funds between accounts.',
  }),
  defineRoute('DELETE', '/api/transfers/:id', {
    status: STATUS.SECURITY_BLOCKED,
    group: 'accounting',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'accounting.transfers declares view / sidebar / create / edit and no delete. Same reasoning ' +
      'as the bank-deposit delete: no honest mapping exists without a permission change.',
    notes: [
      'Remains guarded by authorize("admin", "operator").',
      'ACCOUNTING DELETE INTEGRITY ISSUE REMAINS OPEN.',
    ],
  }),

  /* ── Vendor advances ───────────────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    ['/api/vendor-advances/available/:vendorId', '/api/vendor-advances/position/:vendorId'],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'accounting',
      module: 'accounting',
      submodule: 'payments',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason:
        "A vendor's unapplied advances and net position — payment data, read through the payments " +
        'capability.',
      notes: ['These declare no route-level authenticate; only the global /api gate covers them.'],
    },
  ),
  ...defineRoutes(
    ['POST'],
    ['/api/vendor-advances/apply', '/api/vendor-advances/applications/:id/reverse'],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'accounting',
      module: 'accounting',
      submodule: 'payments',
      action: 'edit',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason:
        'Applying an advance to a bill, and reversing that application, both re-point money that ' +
        'has already moved. Authenticate-only today with no role guard at all.',
      notes: ['These declare no route-level authenticate; only the global /api gate covers them.'],
    },
  ),

  /* ── Cost centres ──────────────────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    [
      '/api/cost-centers',
      '/api/cost-centers/:id',
      '/api/cost-centers/:id/usage',
      '/api/cost-center-corrections/search-transactions',
      '/api/cost-center-corrections/audit-history',
    ],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'accounting',
      module: 'management',
      submodule: 'cost_centres',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason:
        'Cost centre master, usage, and the correction search and audit history. Brick 1 recorded ' +
        'that two sidebar rows share this one key.',
      notes: [COST_CENTRE_NO_BASELINE],
    },
  ),
  defineRoute('POST', '/api/cost-centers', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'management',
    submodule: 'cost_centres',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Creates a cost centre.',
    notes: [COST_CENTRE_NO_BASELINE],
  }),
  defineRoute('PUT', '/api/cost-centers/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'management',
    submodule: 'cost_centres',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Edits a cost centre.',
    notes: [COST_CENTRE_NO_BASELINE],
  }),
  defineRoute('PATCH', '/api/cost-centers/:id/status', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'accounting',
    module: 'management',
    submodule: 'cost_centres',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Activates or retires a cost centre.',
    notes: [COST_CENTRE_NO_BASELINE],
  }),
  ...defineRoutes(
    ['POST'],
    [
      '/api/cost-centers/bulk-reassign',
      '/api/cost-center-bulk/assign',
      '/api/cost-center-bulk/replace',
    ],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'accounting',
      module: 'management',
      submodule: 'cost_centres',
      action: 'edit',
      legacy: LEGACY.ROLE_STRING,
      reason:
        'Bulk reassignment rewrites the cost-centre attribution of already-posted transactions. ' +
        'EDIT on the cost-centre capability is the closest catalog-supported fit.',
      notes: [
        COST_CENTRE_NO_BASELINE,
        'These mutate posted allocations. Brick 1 flagged the same concern; Brick 8 gates who may ' +
          'call them and does not change what they do.',
      ],
    },
  ),

  /* ── Accounting diagnostics ────────────────────────────────────────────── */

  defineRoute('GET', '/api/debug/accounting-health', {
    status: STATUS.LEGACY_ROLE_GUARD,
    group: 'accounting',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'An integrity self-check that reports imbalances across the ledger. It is an operator ' +
      'diagnostic rather than a business capability, and no catalog entry describes it.',
    notes: ['KEEP AS ROLE IDENTITY for now; revisit if an accounting-diagnostics capability is added.'],
  }),
];
