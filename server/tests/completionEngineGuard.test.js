// Completion-engine guard — the Return Engine is the ONLY completion path
// for RETURN_BASED (and all Growth-group) processes. Pure-predicate truth
// table plus static source contracts on the legacy endpoint.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  requiresReturnEngineCompletion,
  RETURN_ENGINE_REQUIRED_MESSAGE,
} = require('../services/completionEngineGuard');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// ── Pure predicate ────────────────────────────────────────────────────────────
test('RETURN_BASED always requires the Return Engine', () => {
  assert.equal(requiresReturnEngineCompletion({ completionMode: 'RETURN_BASED', processGroup: 'LASER' }), true);
  assert.equal(requiresReturnEngineCompletion({ completionMode: 'return_based', processGroup: null }), true);
});

test('Growth NEVER uses legacy completion, even with a stale OUTPUT_BASED row', () => {
  assert.equal(requiresReturnEngineCompletion({ completionMode: 'OUTPUT_BASED', processGroup: 'GROWTH' }), true);
  assert.equal(requiresReturnEngineCompletion({ completionMode: 'OUTPUT_BASED', processGroup: 'growth' }), true);
});

test('unknown/missing completion_mode defaults to the Return Engine', () => {
  assert.equal(requiresReturnEngineCompletion({ completionMode: null, processGroup: 'OTHER' }), true);
  assert.equal(requiresReturnEngineCompletion({ completionMode: undefined, processGroup: null }), true);
  assert.equal(requiresReturnEngineCompletion({ completionMode: '', processGroup: 'LASER' }), true);
});

test('only an explicit non-Growth OUTPUT_BASED process may use legacy completion', () => {
  assert.equal(requiresReturnEngineCompletion({ completionMode: 'OUTPUT_BASED', processGroup: 'OTHER' }), false);
  assert.equal(requiresReturnEngineCompletion({ completionMode: 'OUTPUT_BASED', processGroup: null }), false);
});

test('guard message is operator-facing and stable', () => {
  assert.equal(RETURN_ENGINE_REQUIRED_MESSAGE, 'This process must be completed through Process Return.');
});

// ── Endpoint source contracts ─────────────────────────────────────────────────
test('/processes/:id/complete rejects Return-engine processes BEFORE any write', () => {
  const src = read(path.join('routes', 'manufacturingProcesses.js'));
  const completeStart = src.indexOf("router.patch('/processes/:id/complete'");
  assert.ok(completeStart > -1, 'complete endpoint exists');
  const guardAt = src.indexOf('requiresReturnEngineCompletion', completeStart);
  assert.ok(guardAt > -1, 'complete endpoint calls requiresReturnEngineCompletion');
  // Every write statement of the endpoint body must come AFTER the guard call.
  const handlerEnd = src.indexOf("router.patch('/machines/:id/status'", completeStart);
  const body = src.slice(completeStart, handlerEnd);
  const firstWrite = body.search(/UPDATE\s+(inventory|lot_process_issues|machine_processes|machines)|INSERT\s+INTO/i);
  assert.ok(firstWrite > -1, 'endpoint still performs its legacy writes for OUTPUT_BASED');
  assert.ok(body.indexOf('requiresReturnEngineCompletion') < firstWrite,
    'guard must precede the first inventory/issue/process/machine/history write');
});

test('awaiting_output is not manually writable and never newly written', () => {
  const mfg = read(path.join('routes', 'manufacturingProcesses.js'));
  const machineStatuses = mfg.match(/const MACHINE_STATUSES = \[([^\]]*)\]/);
  assert.ok(machineStatuses, 'MACHINE_STATUSES list exists');
  assert.doesNotMatch(machineStatuses[1], /awaiting_output/,
    'awaiting_output must not be an accepted manual machine status');
  const writes = /(?:UPDATE\s+machines\s+SET|finalStatus\s*=)\s*[^;]*'awaiting_output'/i;
  assert.doesNotMatch(mfg, writes, 'manufacturingProcesses.js must not write awaiting_output');
  const lpi = read(path.join('routes', 'lotProcessIssues.js'));
  assert.doesNotMatch(lpi, /status\s*=\s*'awaiting_output'/i,
    'Return engine must not write awaiting_output');
});

test('legacy Growth Run Return modal is removed from the Control Tower', () => {
  const dash = fs.readFileSync(path.join(
    __dirname, '..', '..', 'client', 'src', 'modules', 'manufacturing', 'pages',
    'ManufacturingDashboardPage.jsx'), 'utf8');
  assert.doesNotMatch(dash, /isGrowthReturn/, 'growth-return modal branch removed');
  assert.doesNotMatch(dash, /Save & Release/, 'Save & Release action removed');
  assert.match(dash, /Record Return/, 'Record Return launcher present');
  assert.match(dash, /Return Unavailable/, 'zero-issue state is explicit, not hidden');
  assert.match(dash, /usesReturnEngine/, 'completion action derives from Return-engine ownership');
});
