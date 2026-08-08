/**
 * RBAC Brick 8 — route classification: Stock Transfer.
 *
 * Rollout group: `stock_transfer`. Catalog risk: CRITICAL.
 *
 * WHAT THE AUDIT FOUND
 * ─────────────────────
 * Of the eleven endpoints, only two consult a capability today: `/preview` and
 * `/export`. Approve, reject and delete-pending are `authenticate` and nothing
 * more. Reject is the sharpest case — it has no permission check, no ownership
 * check and no department check, so any authenticated user can reject any
 * pending transfer in the system.
 *
 * WHAT STRICT DOES AND DOES NOT FIX
 * ──────────────────────────────────
 * STRICT answers "may this user perform approvals at all". It does NOT answer
 * "may this user approve FOR the destination department", because that authority
 * is not modelled anywhere — Brick 5 recorded it as missing and Brick 8 is
 * forbidden to invent it. Those routes are therefore marked
 * AUTHORITY_MODEL_MISSING, and the existing in-handler rules stay exactly as
 * they are:
 *
 *   - status must still be Pending
 *   - the creator still cannot approve their own transfer (self-approval guard,
 *     routes/stockTransfer.js approve step 3)
 *   - delete-pending still matches `created_by = $2`, so it can only cancel the
 *     caller's own transfer
 *
 * A capability bit does not replace any of those, and the guard runs BEFORE
 * them, so none is bypassed.
 */

'use strict';

const { defineRoute, defineRoutes, STATUS, GUARD, LEGACY, AUTHORITY } = require('./defineRoute');

const SCOPE_NOTE =
  'Department visibility continues to come from getTransferDeptScope / loadDeptScope. Visibility ' +
  'is not authority: seeing a transfer has never implied being allowed to approve it, and STRICT ' +
  'does not change that.';

module.exports = [
  /* ── Read ──────────────────────────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    ['/api/stock-transfer', '/api/stock-transfer/history', '/api/stock-transfer/pending'],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'stock_transfer',
      module: 'inventory',
      submodule: 'stock_transfer',
      action: 'view',
      legacy: LEGACY.INVENTORY_SCOPE,
      authority: AUTHORITY.IN_HANDLER,
      reason:
        'Transfer lists. Rows are already department-scoped; the stock_transfer bitmask is not ' +
        'consulted today, so any authenticated user can list transfers for their departments.',
      notes: [SCOPE_NOTE],
    },
  ),

  defineRoute('GET', '/api/stock-transfer/pending/:id/debug', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'stock_transfer',
    module: 'inventory',
    submodule: 'stock_transfer',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason:
      'Returns the raw pending_transfers row plus resolved source and destination names for one ' +
      'transfer. It is a diagnostic, but it returns real transfer data, so it is gated as a read.',
    notes: [
      'This endpoint applies no department scope, unlike the list it sits beside.',
      'RECOMMENDED: remove, or apply the same scope as GET /api/stock-transfer/pending.',
    ],
  }),

  defineRoute('GET', '/api/stock-transfer/export', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'stock_transfer',
    guard: GUARD.HANDLER,
    module: 'inventory',
    submodule: 'stock_transfer',
    action: 'export',
    legacy: LEGACY.EFFECTIVE_PERMISSION,
    reason:
      'routes/stockTransfer.js:1117 already resolves inventory/<action>/stock_transfer, choosing ' +
      'export or print from the format parameter, and then queries through the same scoped helper ' +
      'the UI list uses. A fixed route guard would have to pick one of the two actions.',
    notes: [
      'The export query is built by queryScopedTransfers, so hidden departments cannot be read ' +
        'back through the export path.',
    ],
  }),

  /* ── Create ────────────────────────────────────────────────────────────── */

  defineRoute('POST', '/api/stock-transfer/preview', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'stock_transfer',
    guard: GUARD.HANDLER,
    module: 'inventory',
    submodule: 'stock_transfer',
    action: 'view',
    legacy: LEGACY.EFFECTIVE_PERMISSION,
    reason:
      'routes/stockTransfer.js:108-113 admits the caller on VIEW **or** CREATE, then requires every ' +
      'requested lot to be in scope. A route guard can only test one action, so guarding on VIEW ' +
      'would newly reject a create-only user who is admitted today. Left with the handler.',
    notes: [SCOPE_NOTE, 'Out-of-scope lots reject the whole request with a message naming no lot.'],
  }),

  defineRoute('POST', '/api/stock-transfer/pending', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'stock_transfer',
    module: 'inventory',
    submodule: 'stock_transfer',
    action: 'create',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason:
      'Raises a pending transfer for approval. Currently authenticate-only, so any signed-in user ' +
      'can queue a transfer of any lot they can see.',
  }),

  defineRoute('POST', '/api/stock-transfer', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'stock_transfer',
    module: 'inventory',
    submodule: 'stock_transfer',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'The direct (non-pending) transfer path. Same capability as raising a pending transfer, ' +
      'because it produces the same movement without the approval step.',
  }),

  /* ── Approve / reject / cancel ─────────────────────────────────────────── */

  defineRoute('POST', '/api/stock-transfer/pending/:id/approve', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'stock_transfer',
    module: 'inventory',
    submodule: 'stock_transfer',
    action: 'approve',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    authority: AUTHORITY.MODEL_MISSING,
    reason:
      'Approval commits the movement and rewrites lot departments. It is authenticate-only today: ' +
      'any signed-in user who is not the creator can approve any pending transfer.',
    notes: [
      'AUTHORITY GAP: `approve` says the user may perform approvals; it does not say for which ' +
        'destination department. That authority is not modelled (Brick 5), and Brick 8 does not ' +
        'invent it. STRICT narrows the population that can approve; it does not partition it.',
      'PRESERVED: the self-approval guard and the Pending-status precondition run after this guard ' +
        'and are untouched.',
    ],
  }),

  defineRoute('POST', '/api/stock-transfer/pending/:id/reject', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'stock_transfer',
    module: 'inventory',
    submodule: 'stock_transfer',
    action: 'reject',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    authority: AUTHORITY.MODEL_MISSING,
    reason:
      'The weakest endpoint in the workflow. It checks only that the transfer exists and is still ' +
      'Pending — no permission, no ownership, no department. Any authenticated user can reject any ' +
      "other user's pending transfer, and unlike approve there is not even a self-rejection rule.",
    notes: [
      'AUTHORITY GAP: as for approve, the destination department is not part of the decision.',
      'This is the clearest single reason to move stock_transfer to SHADOW early: the mismatch ' +
        'report will show exactly who has been able to reach it.',
    ],
  }),

  defineRoute('DELETE', '/api/stock-transfer/pending/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'stock_transfer',
    module: 'inventory',
    submodule: 'stock_transfer',
    action: 'delete',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    authority: AUTHORITY.IN_HANDLER,
    reason:
      'Cancels a pending transfer. The DELETE statement already restricts itself to ' +
      "`created_by = $2 AND status = 'Pending'`, so a caller can only cancel their own; the " +
      'capability adds whether they may cancel at all.',
    notes: [
      'PRESERVED: the created_by ownership predicate is part of the SQL, not of any middleware, and ' +
        'is unaffected by enforcement mode.',
    ],
  }),
];
