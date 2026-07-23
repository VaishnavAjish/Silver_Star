const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('Process Master requires_machine contract: 4 approved processes do not require machine', () => {
  const lotProcessIssuesSource = fs.readFileSync(
    path.join(__dirname, '../routes/lotProcessIssues.js'),
    'utf8'
  );

  // 1. Backend loads processRules and checks requires_machine
  assert.ok(
    lotProcessIssuesSource.includes('const requiresMachine = !!processRules.requires_machine;'),
    'lotProcessIssues.js must derive requiresMachine from processRules.requires_machine'
  );

  // 2. Backend locks machine only if requiresMachine is true
  assert.ok(
    lotProcessIssuesSource.includes('if (requiresMachine) {'),
    'lotProcessIssues.js must conditionally validate and lock machine only when requiresMachine is true'
  );

  // 3. Backend updates machine status to running only if requiresMachine and effectiveMachineId
  assert.ok(
    lotProcessIssuesSource.includes('if (requiresMachine && effectiveMachineId) {'),
    'lotProcessIssues.js must conditionally set machine to running only when requiresMachine is true'
  );

  // 4. Return release machine guarded by mp.machine_id
  assert.ok(
    lotProcessIssuesSource.includes('if (mp.machine_id) {'),
    'lotProcessIssues.js must check if mp.machine_id is present before attempting machine release on Return'
  );
});

test('Frontend LotIssuePage contract: checks requires_machine', () => {
  const lotIssuePageSource = fs.readFileSync(
    path.join(__dirname, '../../client/src/modules/inventory/pages/LotIssuePage.jsx'),
    'utf8'
  );

  assert.ok(
    lotIssuePageSource.includes('const requiresMachine = selectedProcess ? !!selectedProcess.requires_machine'),
    'LotIssuePage.jsx must derive requiresMachine from selectedProcess'
  );

  assert.ok(
    lotIssuePageSource.includes('Machine not required for this process'),
    'LotIssuePage.jsx must display informational notice when Machine is not required'
  );

  assert.ok(
    lotIssuePageSource.includes('requiresMachine ? !!machineId : true'),
    'LotIssuePage.jsx validation must only require machineId when requiresMachine is true'
  );
});
