// Inventory display-contract tests — run with `node --test`. Pure, no DOM/DB.
// Proves physical Location, functional Department and transaction Source are
// bound and rendered as strictly separate columns.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  LOCATION_COL, DEPARTMENT_COL, SOURCE_COL,
  resolveLocation, resolveDepartment, resolveSource,
} from './inventoryDisplay.js';

// A representative physically-mapped row and an unmapped one.
const mapped = {
  location_name: 'Ichapore Factory (K17)',
  dept_name: 'Growing',
  dept_location_name: 'Ichapore Factory (K17)',
  source_module: 'Growth Run',
};
const unmapped = {
  location_name: null,
  dept_name: null,
  dept_location_name: null,
  source_module: 'Return from Process',
};

// ── Column contract ───────────────────────────────────────────────────────────
test('1. Department Name column binds dept_name', () => {
  assert.equal(DEPARTMENT_COL.key, 'dept_name');
  assert.equal(DEPARTMENT_COL.label, 'Department Name');
});

test('2. Department Name is NOT bound to dept_location_name', () => {
  assert.notEqual(DEPARTMENT_COL.key, 'dept_location_name');
  // resolver ignores dept_location_name entirely
  assert.equal(resolveDepartment({ dept_location_name: 'Ichapore Factory (K17)' }), '');
});

test('3. Location column binds location_name and renders it', () => {
  assert.equal(LOCATION_COL.key, 'location_name');
  assert.equal(LOCATION_COL.label, 'Location');
  assert.equal(resolveLocation(mapped), 'Ichapore Factory (K17)');
});

test('4. Location falls back to dept_location_name when location_name absent', () => {
  const row = { location_name: null, dept_location_name: 'Ichapore Factory (K17)', source_module: 'Growth Run' };
  assert.equal(resolveLocation(row), 'Ichapore Factory (K17)');
});

test('5. Location NEVER falls back to source_module', () => {
  assert.equal(resolveLocation(unmapped), ''); // not "Return from Process"
  for (const s of ['Growth Run', 'Return from Process', 'Process Issues', 'Stock Transfer']) {
    assert.equal(resolveLocation({ location_name: null, dept_location_name: null, source_module: s }), '');
  }
});

// ── Source-only values (tests 6-8) ────────────────────────────────────────────
for (const [n, value] of [[6, 'Growth Run'], [7, 'Return from Process'], [8, 'Process Issues']]) {
  test(`${n}. "${value}" appears only in Source, never Location/Department`, () => {
    const row = { location_name: null, dept_name: null, dept_location_name: null, source_module: value };
    assert.equal(resolveSource(row), value);
    assert.equal(resolveLocation(row), '');
    assert.equal(resolveDepartment(row), '');
  });
}

test('Source column binds source_module', () => {
  assert.equal(SOURCE_COL.key, 'source_module');
  assert.equal(SOURCE_COL.label, 'Source');
});

test('mapped row: Department renders dept_name, Location renders location_name, Source renders source_module', () => {
  assert.equal(resolveDepartment(mapped), 'Growing');
  assert.equal(resolveLocation(mapped), 'Ichapore Factory (K17)');
  assert.equal(resolveSource(mapped), 'Growth Run');
});

test('empty source resolves to ""', () => {
  assert.equal(resolveSource({ source_module: null }), '');
  assert.equal(resolveSource({}), '');
});
