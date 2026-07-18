// Growth-Again Return lifecycle — display context resolution (queue +
// workspace), atomic machine release guards, and the SSD-100 guarded
// reconciliation contracts. Pure truth tables + static source contracts
// (no DB reachable from dev).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { resolveIssueGrowthContext } = require('../services/growthIssueContext');
const { assessMachineRelease } = require('../services/machineReleaseGuard');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const lpiSrc = read(path.join('routes', 'lotProcessIssues.js'));
const mfgSrc = read(path.join('routes', 'manufacturingProcesses.js'));

// ── Issue display context (tests 1–5) ─────────────────────────────────────────
// The production shape: growth_diamond carrier, legacy growth_run link blank.
const ssd100Row = {
  issue_number: 'PI-202607-0385',
  process_lot_category: 'growth_diamond',
  process_lot_number: 'SSD013-APR26-011',
  process_lot_run_no: 4,
  process_lot_dim_length: 12, process_lot_dim_depth: 12, process_lot_dim_height: 5.74,
  process_lot_dim_unit: 'mm',
  growth_number: null, run_no: null,
  growth_dim_length: null, growth_dim_depth: null, growth_dim_height: null, growth_dim_unit: null,
};

test('growth_diamond carrier resolves permanent Growth Number, Run and dimensions (never "—")', () => {
  const r = resolveIssueGrowthContext(ssd100Row);
  assert.equal(r.growth_number, 'SSD013-APR26-011');
  assert.equal(r.run_no, 4);
  assert.equal(r.growth_dim_length, 12);
  assert.equal(r.growth_dim_depth, 12);
  assert.equal(r.growth_dim_height, 5.74);
  assert.equal(r.growth_dim_unit, 'mm');
  assert.equal(r.growth_identity_source, 'carrier');
});

test('growth_run carrier resolves identically (identity-preserving order is category-wide)', () => {
  const r = resolveIssueGrowthContext({ ...ssd100Row, process_lot_category: 'growth_run' });
  assert.equal(r.growth_number, 'SSD013-APR26-011');
  assert.equal(r.run_no, 4);
});

test('carrier identity wins over a stale legacy growth_run link (current Run, not a historical one)', () => {
  const r = resolveIssueGrowthContext({
    ...ssd100Row,
    growth_number: 'SSD001-JUL26-055', run_no: 3, growth_dim_height: 9.99,
  });
  assert.equal(r.growth_number, 'SSD013-APR26-011');
  assert.equal(r.run_no, 4);
  assert.equal(r.growth_dim_height, 5.74);
});

test('non-carrier issue keeps the legacy growth_run linkage as its only growth context', () => {
  const r = resolveIssueGrowthContext({
    process_lot_category: 'seed', process_lot_number: 'SEED-1', process_lot_run_no: 9,
    growth_number: 'SSD002-MAY26-002', run_no: 1,
  });
  assert.equal(r.growth_number, 'SSD002-MAY26-002');
  assert.equal(r.run_no, 1);
  assert.equal(r.growth_identity_source, 'growth_run_link');
});

test('resolver is immutable and fills carrier gaps from the legacy link', () => {
  const input = { ...ssd100Row, process_lot_dim_unit: null, growth_dim_unit: 'mm' };
  const r = resolveIssueGrowthContext(input);
  assert.equal(r.growth_dim_unit, 'mm');
  assert.equal(input.growth_number, null, 'input row must not be mutated');
});

test('queue and workspace read the same resolver; carrier fields selected from the process lot', () => {
  const uses = lpiSrc.match(/resolveIssueGrowthContext/g) || [];
  assert.ok(uses.length >= 3, 'require + queue map + detail spread');
  assert.match(lpiSrc, /rows\.map\(resolveIssueGrowthContext\)/, 'queue maps every row');
  assert.match(lpiSrc, /\.\.\.resolveIssueGrowthContext\(rows\[0\]\)/, 'workspace detail resolves the same way');
  assert.match(lpiSrc, /process_lot_run_no/, 'carrier run selected');
  assert.match(lpiSrc, /process_lot_category/, 'carrier category selected');
});

test('legacy growth linkage now matches growth_diamond carriers too (queue, count, detail, cards, last run)', () => {
  const widened = /category IN \('growth_run','growth_diamond'\)/g;
  assert.ok((lpiSrc.match(widened) || []).length >= 3, 'queue + count + detail joins widened');
  assert.ok((mfgSrc.match(widened) || []).length >= 2, 'machine card + Last Completed Run joins widened');
});

// ── Machine release guards (tests 8–9, 13–14, 16) ─────────────────────────────
const activeMp = { machine_id: 100, status: 'running' };

test('release allowed: right machine, active process, exactly one active', () => {
  assert.deepEqual(
    assessMachineRelease({ issueMachineId: 100, machineProcess: activeMp, activeProcessCount: 1 }),
    { ok: true, reason: null });
});

test('release blocked: missing or terminal machine process', () => {
  assert.equal(assessMachineRelease({ issueMachineId: 100, machineProcess: null, activeProcessCount: 1 }).ok, false);
  assert.equal(assessMachineRelease({
    issueMachineId: 100, machineProcess: { machine_id: 100, status: 'completed' }, activeProcessCount: 1,
  }).ok, false);
});

test('release blocked: process belongs to another machine', () => {
  const r = assessMachineRelease({ issueMachineId: 55, machineProcess: activeMp, activeProcessCount: 1 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /different machine/);
});

test('release blocked: zero or multiple active processes on the machine', () => {
  assert.equal(assessMachineRelease({ issueMachineId: 100, machineProcess: activeMp, activeProcessCount: 0 }).ok, false);
  assert.equal(assessMachineRelease({ issueMachineId: 100, machineProcess: activeMp, activeProcessCount: 2 }).ok, false);
});

test('final Return completes machine lifecycle atomically with row-count guards', () => {
  assert.match(lpiSrc, /machine-bound but has no linked/, 'missing linkage blocks the final Return');
  assert.match(lpiSrc, /assessMachineRelease\(/, 'pure release guard wired into the Return');
  assert.match(lpiSrc, /expected to update exactly one Process Issue/);
  assert.match(lpiSrc, /expected to complete exactly one machine process/);
  assert.match(lpiSrc, /expected to release exactly one machine/);
  assert.match(lpiSrc, /requiresReturnEngineCompletion\(\{\s*completionMode: mp\.completion_mode/,
    'Growth-group processes complete via the Return even with a stale OUTPUT_BASED row');
});

// ── SSD-100 diagnostic + reconciliation contracts (tests 15–16) ──────────────
test('SSD-100 diagnostic is strictly read-only and classifies the six-way state', () => {
  const sql = read(path.join('sql', 'ssd100-growth-again-diagnostic.sql'));
  assert.match(sql, /BEGIN TRANSACTION READ ONLY/);
  assert.match(sql, /ROLLBACK;\s*$/);
  assert.doesNotMatch(sql, /\bUPDATE\b|\bINSERT\b|\bDELETE\b/i);
  for (const c of ['FULL_RETURN_MACHINE_CACHE_STALE', 'ISSUE_NOT_COMPLETED',
    'MACHINE_PROCESS_NOT_COMPLETED', 'RETURN_LINKED_TO_WRONG_MACHINE_PROCESS',
    'MULTIPLE_OR_CONFLICTING_MACHINE_PROCESSES', 'AMBIGUOUS_MANUAL_REVIEW']) {
    assert.ok(sql.includes(c), `classification ${c} present`);
  }
});

test('phase71 reconciliation never re-returns or touches inventory and aborts on conflicts', () => {
  const sql = read(path.join('migrations', 'phase71-ssd100-machine-release.sql'));
  assert.doesNotMatch(sql, /UPDATE\s+inventory/i, 'inventory 100594 must never change');
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+lot_process_returns/i, 'no second Return');
  assert.doesNotMatch(sql, /UPDATE\s+lot_process_issues/i, 'issue rows untouched');
  assert.match(sql, /MULTIPLE_OR_CONFLICTING_MACHINE_PROCESSES/, 'aborts on conflicting active process');
  assert.match(sql, /ISSUE_NOT_COMPLETED/, 'Case C requires manual review');
  assert.match(sql, /GET DIAGNOSTICS/, 'row-count verified on every repair UPDATE');
  assert.match(sql, /completed_at = COALESCE\(v_return_ts/, 'Case B completed_at from the Return timestamp');
});

test('queue detail action no longer routes Growth Runs to the retired Control Tower dialog', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'src', 'modules',
    'inventory', 'pages', 'LotIssueListPage.jsx'), 'utf8');
  assert.doesNotMatch(page, /Complete Growth Run/);
  assert.doesNotMatch(page, /manufacturing\/control-tower/);
});
