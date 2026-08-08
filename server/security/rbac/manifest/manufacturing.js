/**
 * RBAC Brick 8 — route classification: Manufacturing and Rough Diamonds.
 *
 * Rollout groups: `manufacturing`, `rough`.
 *
 * THE CONTROL TOWER IS UNGUARDED TODAY
 * ─────────────────────────────────────
 * Every /api/manufacturing endpoint is `authenticate` and nothing else — Brick 1
 * recorded this and the route walk confirms it. That includes starting a
 * process, holding it, resuming it, completing it and changing a machine's
 * status. Completion in particular drives the Return Engine, so an unguarded
 * PATCH there moves real material.
 *
 * THE LEGACY PROCESS NAMESPACE
 * ─────────────────────────────
 * /api/process and /api/process-transactions are live and role-guarded, but the
 * catalog marks every `process.*` key LEGACY_ORPHAN: the permission rows exist
 * and nothing reads them any more. Enforcing against an orphaned key would deny
 * every non-Super-Admin, because no role baseline was ever seeded for it. Those
 * fourteen paths are therefore SECURITY_BLOCKED — an explicit refusal to guess,
 * not an oversight. They keep their existing role-string guard.
 *
 * SEED REMOVE OVERRIDE
 * ─────────────────────
 * routes/lotProcessIssues.js:1650 asks for the action `seed_remove_override`,
 * which is not in PERM_BITS. `hasPermission` returns false for it every time, so
 * that branch is an unconditional deny for everyone except Super Admin, who
 * short-circuits before it. Brick 8 does not add the bit — inventing a
 * permission is out of scope — and the guard's UNKNOWN_ACTION rule means any
 * future use of a non-existent action fails closed rather than silently passing.
 */

'use strict';

const { defineRoute, defineRoutes, STATUS, LEGACY, AUTHORITY } = require('./defineRoute');

const PROCESS_ALIASES = ['/api/process', '/api/process-transactions'];
const ROUGH_ALIASES = ['/api/rough', '/api/rough-growth'];

const ORPHAN_REASON =
  'Live route, orphaned capability. The Brick 1 catalog classifies every process.* key as ' +
  'LEGACY_ORPHAN — the permission rows survive but the feature they guarded was re-keyed, and no ' +
  'role baseline is seeded for them. Enforcing against such a key under STRICT would deny every ' +
  'user who is not Super Admin. Re-keying these routes onto inventory.process_issues would be a ' +
  'permission decision, which this brick may not take.';

module.exports = [
  /* ── Control Tower reads ───────────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    [
      '/api/manufacturing/kpi',
      '/api/manufacturing/alerts',
      '/api/manufacturing/machines',
      '/api/manufacturing/machine-logs/:machineId',
    ],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'manufacturing',
      module: 'manufacturing',
      submodule: 'control_tower',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason:
        'The Control Tower board: live machine state, alerts and throughput. Authenticate-only ' +
        'today, so any signed-in user sees the whole factory floor.',
    },
  ),

  /* ── Process reads ─────────────────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    [
      '/api/manufacturing/processes',
      '/api/manufacturing/processes/:id',
      '/api/manufacturing/processes/:id/output-context',
      '/api/manufacturing/lookup/awaiting-output',
      '/api/manufacturing/lookup/operators',
      '/api/manufacturing/lookup/seed-lots',
    ],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'manufacturing',
      module: 'manufacturing',
      submodule: '',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason:
        'Process records and the lookups that feed the start-process form. Module-level VIEW is the ' +
        'right grain: these are not one screen, they are the module.',
    },
  ),

  /* ── Process mutations ─────────────────────────────────────────────────── */

  defineRoute('POST', '/api/manufacturing/processes', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'manufacturing',
    module: 'manufacturing',
    submodule: '',
    action: 'create',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason:
      'Starts a machine process and consumes seed lots. Authenticate-only today — the highest-risk ' +
      'unguarded mutation in this module.',
  }),

  ...defineRoutes(
    ['PATCH'],
    [
      '/api/manufacturing/processes/:id/hold',
      '/api/manufacturing/processes/:id/resume',
      '/api/manufacturing/processes/:id/complete',
    ],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'manufacturing',
      module: 'manufacturing',
      submodule: '',
      action: 'edit',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      authority: AUTHORITY.IN_HANDLER,
      reason:
        'Process lifecycle transitions. Completion is the trigger the Return Engine keys off, so ' +
        'this is a material movement, not a status label.',
      notes: [
        'PRESERVED: the completion-engine state guards in the handler decide whether a transition ' +
          'is legal at all. The capability decides who may attempt one.',
      ],
    },
  ),

  defineRoute('PATCH', '/api/manufacturing/machines/:id/status', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'manufacturing',
    module: 'manufacturing',
    submodule: '',
    action: 'edit',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason:
      "Changes a machine's operational state (running, idle, maintenance). Deliberately mapped to " +
      'manufacturing EDIT and not to management.machines EDIT: management.machines governs the ' +
      'machine master record, and a shop-floor status change must not require master-data rights.',
  }),

  /* ── Process Master ────────────────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    ['/api/process-master', '/api/process-master/:id', '/api/process-master/by-code/:code'],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'manufacturing',
      module: 'management',
      submodule: 'process_master',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason:
        'Process definitions. management.process_master is the canonical code; the ' +
        'manufacturing.process_master duplicate is not used.',
    },
  ),
  defineRoute('POST', '/api/process-master', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'manufacturing',
    module: 'management',
    submodule: 'process_master',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Defines a new process type — master data that every run depends on.',
  }),
  defineRoute('PATCH', '/api/process-master/:id', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'manufacturing',
    module: 'management',
    submodule: 'process_master',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Edits a process definition, including its completion mode. Owner-controlled configuration ' +
      'that changes how every subsequent run behaves.',
  }),

  /* ── Process Issues and Returns ────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    [
      '/api/lot-process-issues',
      '/api/lot-process-issues/:id',
      '/api/lot-process-issues/lookup/machines',
      '/api/lot-process-issues/op-log/:lotId',
    ],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'manufacturing',
      module: 'inventory',
      submodule: 'process_issues',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason:
        'Issue records and the operation log. One catalog key serves both the Process Issues and ' +
        'Process Return screens, as Brick 1 recorded.',
    },
  ),
  defineRoute('POST', '/api/lot-process-issues', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'manufacturing',
    module: 'inventory',
    submodule: 'process_issues',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Issues a lot into a process, removing it from available inventory.',
  }),
  defineRoute('POST', '/api/lot-process-issues/:id/return/validate', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'manufacturing',
    module: 'inventory',
    submodule: 'process_issues',
    action: 'view',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'A dry run that computes what a return would produce and writes nothing. VIEW, not EDIT, so ' +
      'checking a return before performing it does not require return authority.',
  }),
  defineRoute('POST', '/api/lot-process-issues/:id/return', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'manufacturing',
    module: 'inventory',
    submodule: 'process_issues',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    authority: AUTHORITY.IN_HANDLER,
    reason:
      'Returns material from a process and creates output lots. EDIT on the shared Process Issues ' +
      'capability, matching how the issue and return screens share one key.',
    notes: [
      'PRESERVED: the weight-variance override inside this handler still resolves ' +
        'process_return/override_weight_variance separately (lotProcessIssues.js:1394, :1762). ' +
        'That capability has no seeded baseline row, so only Super Admin and the hard-coded ' +
        '"operator" role-string branch pass it today.',
      'DEFECT RECORDED, NOT FIXED: lotProcessIssues.js:1650 asks for the action ' +
        '"seed_remove_override", which is absent from PERM_BITS, so that check can never succeed. ' +
        'Adding the bit would be a permission change and is out of scope for Brick 8.',
    ],
  }),

  /* ── Growth Runs ───────────────────────────────────────────────────────── */

  ...defineRoutes(
    ['GET'],
    ['/api/growth-runs', '/api/growth-runs/:id', '/api/growth-runs/by-process/:machineProcessId'],
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'manufacturing',
      module: 'manufacturing',
      submodule: '',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason: 'Growth run records, read through the manufacturing module.',
    },
  ),
  defineRoute('PATCH', '/api/growth-runs/:id/measurements', {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'manufacturing',
    module: 'manufacturing',
    submodule: '',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason:
      'Writes measured weights back onto a growth run. These figures feed yield and variance ' +
      'calculations downstream.',
  }),

  /* ── Legacy process namespace ──────────────────────────────────────────── */

  ...defineRoutes(['GET'], PROCESS_ALIASES, {
    status: STATUS.SECURITY_BLOCKED,
    group: 'manufacturing',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: ORPHAN_REASON,
    notes: ['RECOMMENDED: decide whether this namespace is still used, then re-key or retire it.'],
  }),
  ...defineRoutes(['GET'], PROCESS_ALIASES.map((p) => `${p}/:id`), {
    status: STATUS.SECURITY_BLOCKED,
    group: 'manufacturing',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: ORPHAN_REASON,
  }),
  ...defineRoutes(['GET'], PROCESS_ALIASES.map((p) => `${p}/seeds-in-process`), {
    status: STATUS.SECURITY_BLOCKED,
    group: 'manufacturing',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: ORPHAN_REASON,
  }),
  ...defineRoutes(
    ['POST'],
    PROCESS_ALIASES.flatMap((p) => [
      `${p}/send`,
      `${p}/return`,
      `${p}/_send_legacy`,
      `${p}/_return_legacy`,
    ]),
    {
      status: STATUS.SECURITY_BLOCKED,
      group: 'manufacturing',
      legacy: LEGACY.ROLE_STRING,
      reason: ORPHAN_REASON,
      notes: [
        'These are material movements and remain guarded by authorize("admin", "operator").',
        'The _send_legacy / _return_legacy pair suggests a superseded path that was never removed.',
      ],
    },
  ),

  /* ── Rough Diamonds ────────────────────────────────────────────────────── */

  ...defineRoutes(['GET'], ROUGH_ALIASES, {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'rough',
    module: 'rough',
    submodule: 'rough_growth',
    action: 'view',
    legacy: LEGACY.AUTHENTICATE_ONLY,
    reason: 'Rough growth list.',
  }),
  ...defineRoutes(
    ['GET'],
    ROUGH_ALIASES.flatMap((p) => [
      `${p}/:id`,
      `${p}/process-context/:processId`,
      `${p}/seed-history/:seedId`,
    ]),
    {
      status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
      group: 'rough',
      module: 'rough',
      submodule: 'rough_growth',
      action: 'view',
      legacy: LEGACY.AUTHENTICATE_ONLY,
      reason: 'Rough growth detail, process context and seed lineage.',
    },
  ),
  ...defineRoutes(['POST'], ROUGH_ALIASES, {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'rough',
    module: 'rough',
    submodule: 'rough_growth',
    action: 'create',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Creates a rough growth entry.',
  }),
  ...defineRoutes(['PUT'], ROUGH_ALIASES.map((p) => `${p}/:id`), {
    status: STATUS.EFFECTIVE_PERMISSION_ENFORCED,
    group: 'rough',
    module: 'rough',
    submodule: 'rough_growth',
    action: 'edit',
    legacy: LEGACY.ROLE_STRING,
    reason: 'Edits a rough growth entry.',
  }),
];
