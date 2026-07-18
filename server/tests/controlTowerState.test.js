// Canonical Control Tower state — cards, KPI and alerts must classify from
// ONE model (machineStateModel): active machine_process truth + protected
// overrides. Truth table for the pure mirror + static contracts that both
// queries use the shared SQL and that live awaiting_output is retired.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { deriveMachineState, derivedStateSql, DERIVED_STATES } = require('../services/machineStateModel');

const routeSrc = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'manufacturingProcesses.js'), 'utf8');

// ── Truth table ───────────────────────────────────────────────────────────────
test('protected overrides win over any active process', () => {
  for (const s of ['maintenance', 'breakdown', 'cleaning']) {
    assert.equal(deriveMachineState({ machineStatus: s, activeProcessStatus: 'running' }), s);
    assert.equal(deriveMachineState({ machineStatus: s, activeProcessStatus: null }), s);
  }
});

test('active machine_process truth drives running/hold regardless of the status cache', () => {
  assert.equal(deriveMachineState({ machineStatus: 'idle', activeProcessStatus: 'running' }), 'running');
  assert.equal(deriveMachineState({ machineStatus: 'awaiting_output', activeProcessStatus: 'running' }), 'running');
  assert.equal(deriveMachineState({ machineStatus: 'running', activeProcessStatus: 'hold' }), 'hold');
});

test('AVAILABLE means no active process AND an idle machine', () => {
  assert.equal(deriveMachineState({ machineStatus: 'idle', activeProcessStatus: null }), 'idle');
});

test('contradictions surface as review — never a false normal state', () => {
  // The reported production symptom: AWAITING OUTPUT + "No active process".
  assert.equal(deriveMachineState({ machineStatus: 'awaiting_output', activeProcessStatus: null }), 'review');
  assert.equal(deriveMachineState({ machineStatus: 'running', activeProcessStatus: null }), 'review');
  assert.equal(deriveMachineState({ machineStatus: 'completed', activeProcessStatus: null }), 'review');
  assert.equal(deriveMachineState({ machineStatus: null, activeProcessStatus: null }), 'review');
});

test('derived vocabulary is closed and excludes awaiting_output', () => {
  assert.ok(!DERIVED_STATES.includes('awaiting_output'));
  for (const ms of ['idle', 'running', 'hold', 'awaiting_output', 'completed', 'maintenance', 'breakdown', 'cleaning', null]) {
    for (const ps of ['running', 'hold', null]) {
      assert.ok(DERIVED_STATES.includes(deriveMachineState({ machineStatus: ms, activeProcessStatus: ps })));
    }
  }
});

// ── SQL mirror + single-source contracts ──────────────────────────────────────
test('SQL fragment mirrors the JS classification structure', () => {
  const sql = derivedStateSql('m', 'mp');
  assert.match(sql, /'maintenance','breakdown','cleaning'/);
  assert.match(sql, /mp\.status = 'hold' THEN 'hold'/);
  assert.match(sql, /mp\.status = 'running' THEN 'running'/);
  assert.match(sql, /m\.status::text = 'idle' THEN 'idle'/);
  assert.match(sql, /ELSE 'review'/);
  assert.doesNotMatch(sql, /awaiting_output/);
});

test('/kpi and /machines both use the shared derivedStateSql', () => {
  assert.match(routeSrc, /derivedStateSql\('m', 'amp'\)/, 'KPI counts use the shared model');
  assert.match(routeSrc, /derivedStateSql\('m', 'mp'\)/, 'machine cards use the shared model');
});

test('alerts expose ready_for_return instead of awaiting_output', () => {
  assert.match(routeSrc, /ready_for_return:/);
  assert.doesNotMatch(routeSrc, /awaiting_output:\s*awaitingOutput/);
});
