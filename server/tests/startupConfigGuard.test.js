// Startup configuration regression — server boot must NEVER mutate
// process_master business configuration (the removed app.js auto-reset
// previously forced Growth back to OUTPUT_BASED on every PM2 restart,
// defeating phase65). Static source contract: no DB test infrastructure is
// reachable from dev, so the guarantee is enforced on the bootstrap sources.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('app.js performs no process_master write at startup', () => {
  const src = read('app.js');
  assert.doesNotMatch(src, /UPDATE\s+process_master/i,
    'app.js must not UPDATE process_master at boot');
  assert.doesNotMatch(src, /completion_mode\s*=\s*'OUTPUT_BASED'/i,
    'app.js must not reset completion_mode');
});

test('index.js performs no process_master write at startup', () => {
  const src = read('index.js');
  assert.doesNotMatch(src, /UPDATE\s+process_master/i);
});

test('fix_completion_mode helper is retired', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'fix_completion_mode.js')), false,
    'fix_completion_mode.js performed the same incorrect reset and must stay deleted');
});

test('pr-01 RETURN_BASED survives a restart: no boot path writes completion_mode', () => {
  // A restart re-executes app.js/index.js only. With no completion_mode write
  // in either bootstrap file, a configured RETURN_BASED pr-01 cannot be
  // reverted by PM2 restart. (phase65 itself is owner-run on EC2.)
  for (const f of ['app.js', 'index.js']) {
    assert.doesNotMatch(read(f), /completion_mode/i, `${f} must not touch completion_mode`);
  }
});
