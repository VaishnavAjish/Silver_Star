// Universal Growth carrier identity — canonical process resolution (pr-01),
// Item-Master-based carrier predicate, and the closed child-lot paths.
// Pure truth tables + static source contracts (no DB reachable from dev).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  resolveGrowthProcessContext,
  GROWTH_PROCESS_UNRESOLVED_MESSAGE,
} = require('../services/growthProcessResolver');
const {
  resolveCarrierCategory,
  isIdentityPreservingGrowthCarrier,
} = require('../services/growthCarrier');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const lpiSrc = read(path.join('routes', 'lotProcessIssues.js'));
const mfgSrc = read(path.join('routes', 'manufacturingProcesses.js'));

// ── Process resolution (tests 1–4) ───────────────────────────────────────────
test('canonical pr-01 resolves as Growth even with a NULL process_group', () => {
  const viaGroup = resolveGrowthProcessContext({ processCode: 'pr-01', processGroup: 'GROWTH' });
  assert.deepEqual([viaGroup.isGrowthProcess, viaGroup.isResolved, viaGroup.resolutionSource],
    [true, true, 'process_master.process_group']);
  const viaCode = resolveGrowthProcessContext({ processCode: 'pr-01', processGroup: null });
  assert.deepEqual([viaCode.isGrowthProcess, viaCode.isResolved, viaCode.resolutionSource],
    [true, true, 'canonical_process_code']);
  const legacy = resolveGrowthProcessContext({ processCode: 'growth', processGroup: '' });
  assert.equal(legacy.isGrowthProcess, true);
});

test('explicit process_group always wins over the canonical-code fallback', () => {
  const r = resolveGrowthProcessContext({ processCode: 'pr-01', processGroup: 'LASER' });
  assert.deepEqual([r.isGrowthProcess, r.isResolved], [false, true]);
});

test('unknown process with no group is UNRESOLVED — never silently non-growth-resolved', () => {
  const r = resolveGrowthProcessContext({ processCode: 'mystery-99', processGroup: null });
  assert.deepEqual([r.isGrowthProcess, r.isResolved, r.resolutionSource],
    [false, false, 'unresolved']);
  assert.equal(GROWTH_PROCESS_UNRESOLVED_MESSAGE,
    'Growth carrier process classification is unresolved. No lot was created.');
});

test('client labels cannot override Process Master truth (resolver reads PM fields only)', () => {
  const r = resolveGrowthProcessContext({ processCode: 'GROWTH PROCESS DISPLAY NAME', processGroup: 'LASER' });
  assert.equal(r.isGrowthProcess, false);
});

// ── Carrier classification (tests 5–9) ───────────────────────────────────────
test('canonical categories classify as carriers; rough/seed never do', () => {
  assert.equal(resolveCarrierCategory({ category: 'growth_run' }), 'growth_run');
  assert.equal(resolveCarrierCategory({ category: 'Growth_Diamond' }), 'growth_diamond');
  assert.equal(resolveCarrierCategory({ category: 'rough' }), null);
  assert.equal(resolveCarrierCategory({ category: 'seed', name: 'Growth Diamond' }), null,
    'an explicit non-carrier category is authoritative — the name cannot promote it');
});

test('legacy rows with EMPTY category resolve through approved Item Master aliases', () => {
  assert.equal(resolveCarrierCategory({ category: null, name: 'Partial Growth Run' }), 'growth_run');
  assert.equal(resolveCarrierCategory({ category: '', name: 'Growth Run' }), 'growth_run');
  assert.equal(resolveCarrierCategory({ category: null, name: 'Growth Diamond' }), 'growth_diamond');
  assert.equal(resolveCarrierCategory({ category: null, name: 'Rough Diamond' }), null);
  assert.equal(resolveCarrierCategory({ category: null, name: 'Mystery Widget' }), null,
    'ambiguous items are NOT carriers — callers reject fail-closed, never child-lot');
});

test('predicate prefers the item row and falls back to joined inventory fields', () => {
  assert.equal(isIdentityPreservingGrowthCarrier({ category: 'growth_diamond' }, null), true);
  assert.equal(isIdentityPreservingGrowthCarrier({ item_name: 'Growth Diamond', category: null }, null), true);
  assert.equal(isIdentityPreservingGrowthCarrier({ category: 'growth_run' }, { category: 'seed' }), false,
    'explicit item row wins');
});

// ── Issue path contracts (tests 10–21) ───────────────────────────────────────
test('issue path resolves growth canonically and fails closed for unresolved carriers', () => {
  assert.ok((lpiSrc.match(/resolveGrowthProcessContext\(/g) || []).length >= 3,
    'issue + validate + return all use the canonical resolver');
  assert.doesNotMatch(lpiSrc, /process_type === 'growth'/,
    'the unreliable string fallback is retired as business authority');
  assert.match(lpiSrc, /status\(409\)\.json\(\{ error: GROWTH_PROCESS_UNRESOLVED_MESSAGE \}\)/,
    'carrier + unresolved process → 409, before any write');
  assert.match(lpiSrc, /appliesSeedAttachment\(carrierCategory \|\| lot\.category/,
    'legacy-alias carriers can never be seed-attached');
  assert.match(lpiSrc, /expected to move exactly one inventory row/,
    'in-place issue UPDATE is row-count guarded');
  assert.match(lpiSrc, /expected to advance the Run on exactly one carrier row/,
    'atomic Run increment is row-count guarded');
  assert.match(lpiSrc, /carrier root_lot_id changed during re-issue/,
    'Root Lot immutability asserted at issue time');
  assert.match(lpiSrc, /run_no = \$\{RUN_INCREMENT_SQL\}/,
    'Run still allocated atomically in a single UPDATE under the row lock');
});

// ── Return path contracts (tests 22–29) ──────────────────────────────────────
test('no identity-bearing carrier can reach the generic child-lot branch', () => {
  const invariantAt = lpiSrc.indexOf('Identity-bearing Growth carrier cannot create a child Return lot.');
  const childCodeAt = lpiSrc.indexOf('const childCode = await nextReturnLotCode(client,');
  assert.ok(invariantAt > -1, 'defensive invariant present');
  assert.ok(childCodeAt > -1, 'generic child-lot branch still exists for non-carriers');
  assert.ok(invariantAt < childCodeAt, 'invariant throws BEFORE nextReturnLotCode/INSERT');
  assert.match(lpiSrc, /carrierCategory === 'growth_diamond' && returnCtx\.isGrowthProcess/,
    'a diamond returns in place ONLY on a PROVEN Growth process — known non-Growth ' +
    'processes (Final Block transform, laser) keep their configured routes');
});

test('unresolved return process fails closed with 409 BEFORE any write', () => {
  const postStart = lpiSrc.indexOf("router.post('/:id/return',");
  const body = lpiSrc.slice(postStart);
  const rejectAt = body.indexOf('return res.status(409).json({ error: RETURN_PROCESS_UNRESOLVED_MESSAGE });');
  assert.ok(rejectAt > -1, 'carrier + unresolved classification → 409');
  const firstReturnInsert = body.indexOf('INSERT INTO lot_process_returns');
  const firstIssueUpdate  = body.indexOf('UPDATE lot_process_issues');
  const firstInvWrite     = body.search(/UPDATE\s+inventory|INSERT\s+INTO\s+inventory/);
  assert.ok(firstReturnInsert > -1 && rejectAt < firstReturnInsert, 'rejects before the Return INSERT');
  assert.ok(firstIssueUpdate > -1 && rejectAt < firstIssueUpdate, 'rejects before any Issue update');
  assert.ok(firstInvWrite > -1 && rejectAt < firstInvWrite, 'rejects before any inventory write');
  assert.match(lpiSrc, /route: 'REJECT', error: RETURN_PROCESS_UNRESOLVED_MESSAGE/,
    'validate preflight mirrors the same fail-closed rejection');
});

test('alias resolution is deterministic: one match classifies, many or none stay unresolved', () => {
  const dup = [
    { category: 'growth_run', pattern: /^ambiguous legacy item$/ },
    { category: 'growth_diamond', pattern: /^ambiguous legacy item$/ },
  ];
  assert.equal(resolveCarrierCategory({ category: null, name: 'Ambiguous Legacy Item' }, dup), null,
    'multiple canonical matches are unresolved — never a LIMIT-1 style pick');
  assert.equal(resolveCarrierCategory({ category: null, name: 'Growth Diamond' }), 'growth_diamond',
    'exactly one canonical alias match is accepted');
  assert.equal(resolveCarrierCategory({ category: 'rough', name: 'Growth Diamond' }), null,
    'an explicit Rough category can never be promoted through its name');
});

test('Seed Remove COMPONENT splits remain the approved exception', () => {
  assert.match(lpiSrc, /if \(!isComponentReturn &&\s*\n?\s*resolveCarrierCategory/,
    'the invariant excludes component returns so Seed Remove keeps splitting the assembly');
});

// ── Entry points (tests 32–33) ───────────────────────────────────────────────
test('direct Start Process path cannot accept a Growth carrier (no Issue = no identity guards)', () => {
  assert.match(mfgSrc, /isIdentityPreservingGrowthCarrier\(lkRows\[0\], null\)/,
    'carrier check runs on the locked lot');
  assert.match(mfgSrc, /identity-preserving Growth carrier — start its cycle through Issue to Process/,
    'carriers are 409ed to the Issue-to-Process engine');
});

// ── Diagnostic contract ──────────────────────────────────────────────────────
test('pairs diagnostic is read-only and classifies every reference pair', () => {
  const sql = read(path.join('sql', 'growth-again-pairs-diagnostic.sql'));
  assert.match(sql, /BEGIN TRANSACTION READ ONLY/);
  assert.match(sql, /ROLLBACK;\s*$/);
  assert.doesNotMatch(sql, /\b(UPDATE|INSERT|DELETE)\b/i);
  for (const label of ['HISTORICAL_DUPLICATE_ALREADY_NEUTRALIZED',
    'SAFE_IDENTITY_RECONCILIATION_CANDIDATE', 'HISTORICAL_OLD_BUILD_ONLY',
    'CURRENT_CODE_STILL_REPRODUCIBLE', 'AMBIGUOUS_MANUAL_REVIEW']) {
    assert.ok(sql.includes(label), `classification ${label} present`);
  }
  for (const id of ['100844', '100870', '100745', '100871', '100812', '100594', '100867']) {
    assert.ok(sql.includes(id), `reference inventory ${id} covered`);
  }
});
