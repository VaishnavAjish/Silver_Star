// Registry structure tests — verify the Phase B reorg. Run with `node --test`.
import { test } from 'node:test';
import assert from 'node:assert';
import { NAVIGATION, ALL_ENTRIES, CREATE_ACTIONS, PRESETS } from './registry.js';

function leaves() {
  const out = [];
  for (const n of NAVIGATION) { if (n.children) out.push(...n.children); else out.push(n); }
  return out;
}
const section = (label) => NAVIGATION.find(n => n.label === label);

test('#4: exactly one /inventory/process-issues sidebar row', () => {
  assert.equal(leaves().filter(e => e.path === '/inventory/process-issues').length, 1);
});

test('#5-8: Process Issues/Return/Machines/Process Master live under Manufacturing', () => {
  const mfg = section('Manufacturing').children.map(c => c.id);
  ['control-tower', 'start-process', 'process-issues', 'process-return', 'machines', 'process-master']
    .forEach(id => assert.ok(mfg.includes(id), `Manufacturing missing ${id}`));
  const mgmt = section('Management').children.map(c => c.id);
  assert.ok(!mgmt.includes('machines'));
  assert.ok(!mgmt.includes('process-master'));
});

test('#9: Rough Stock keeps the existing /rough-diamonds/inventory route', () => {
  const rs = ALL_ENTRIES.find(e => e.id === 'rough-stock');
  assert.equal(rs.label, 'Rough Stock');
  assert.equal(rs.path, '/rough-diamonds/inventory');
});

test('#10: Rough Growth shows the Legacy label at the same route', () => {
  const rg = ALL_ENTRIES.find(e => e.id === 'rough-growth-legacy');
  assert.equal(rg.label, 'Rough Growth (Legacy)');
  assert.equal(rg.path, '/rough-growth');
});

test('presets reference only known registry ids', () => {
  const ids = new Set(ALL_ENTRIES.map(e => e.id));
  for (const [name, list] of Object.entries(PRESETS)) {
    for (const id of list) assert.ok(ids.has(id), `preset ${name} → unknown id ${id}`);
  }
});

test('Create actions invent no forbidden routes', () => {
  const paths = CREATE_ACTIONS.map(a => a.path).join(' ');
  assert.ok(!/voucher|credit-note|debit-note/i.test(paths));
});
