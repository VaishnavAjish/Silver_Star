const { test, describe } = require('node:test');
const assert = require('node:assert');
const { reverseGrowthReturn } = require('../services/growthReturnReversal');

describe('Growth Return Reversal Constraints and Core Logic', () => {
  const mockClient = (mockRows = {}) => {
    const executedQueries = [];
    return {
      executedQueries,
      query: async (sql, params) => {
        executedQueries.push({ sql: sql.trim().replace(/\s+/g, ' '), params });
        if (sql.includes('SELECT * FROM lot_process_returns')) return { rows: mockRows.returns || [] };
        if (sql.includes('lot_process_issues')) {
            if (sql.includes('SELECT 1 FROM lot_process_issues')) return { rows: mockRows.laterIssues || [] };
            if (sql.includes('SELECT * FROM lot_process_issues')) return { rows: mockRows.issues || [] };
        }
        if (sql.includes('inventory')) return { rows: mockRows.inventory || [] };
        if (sql.includes('machine_processes')) return { rows: mockRows.machineProcesses || [] };
        if (sql.includes('SELECT status FROM machines')) return { rows: mockRows.machines || [] };
        if (sql.includes('lot_movements')) return { rows: mockRows.laterMoves || [] };
        if (sql.includes('lot_op_log')) {
            if (sql.includes('SELECT 1 FROM lot_op_log')) return { rows: mockRows.laterOps || [] };
        }
        return { rows: [{ next_no: 2 }] }; // For recordGrowthCycle
      }
    };
  };

  test('Rejects if pre_state.version is missing or not 2', async () => {
    const client = mockClient({
      returns: [{ id: 1, pre_state: { version: 1 } }]
    });
    try {
      await reverseGrowthReturn(client, 1, { lotId: 100 });
      assert.fail('Should reject legacy version');
    } catch (e) {
      assert.match(e.message, /Legacy or incomplete return records cannot be reversed safely/);
    }
  });

  test('Rejects if pre_state is incomplete', async () => {
    const client = mockClient({
      returns: [{ id: 1, pre_state: { version: 2, biscuit: {} } }] // Missing process_lot, issue
    });
    try {
      await reverseGrowthReturn(client, 1, { lotId: 100 });
      assert.fail('Should reject incomplete pre_state');
    } catch (e) {
      assert.match(e.message, /Incomplete pre_state snapshot: missing core entities/);
    }
  });

  test('Rejects cross-lot mismatches', async () => {
    const client = mockClient({
      returns: [{ id: 1, pre_state: { version: 2, biscuit: { id: 200 }, process_lot: { id: 300 }, issue: {} } }]
    });
    try {
      await reverseGrowthReturn(client, 1, { lotId: 100 });
      assert.fail('Should reject cross-lot mismatch');
    } catch (e) {
      assert.match(e.message, /Cross-lot canonical keys rejected/);
    }
  });

  test('Accepts identical values up to epsilon, restoring field-by-field', async () => {
    const pre = {
      version: 2,
      route: 'BISCUIT',
      biscuit: { id: 100, weight: 100.000001, dim_length: 50.0001, status: 'AVAILABLE', machine_process_id: 10, lot_number: 'L123', run_no: 1 },
      process_lot: { id: 101, qty: 5, weight: 10, total_value: 50, status: 'CONSUMED' },
      issue: { id: 50, remaining_in_process: 10, status: 'OPEN', machine_id: 5 },
      machine_process: { id: 10, status: 'paused', total_paused_minutes: 5, paused_at: '2023-01-01', completed_at: null },
      machine: { id: 5, status: 'paused' }
    };

    const client = mockClient({
      returns: [{ id: 1, issue_id: 50, pre_state: pre, created_at: '2023-01-01', is_final: true }],
      issues: [{ id: 50, status: 'RETURNED' }],
      inventory: [{ id: 100, weight: 100.000001, dim_length: 50.0001, lot_number: 'L123', run_no: 1, machine_process_id: 10, status: 'IN STOCK' }], // Matches within epsilon
      machineProcesses: [{ id: 10 }],
      machines: [{ status: 'running' }] // Changed, will be restored
    });

    await reverseGrowthReturn(client, 1, { lotId: 100, userId: 1, reason: 'Test' });

    // Ensure we restored exact fields
    const updates = client.executedQueries.filter(q => q.sql.includes('UPDATE'));
    const issueUpdate = updates.find(q => q.sql.includes('UPDATE lot_process_issues'));
    assert.deepStrictEqual(issueUpdate.params, [10, 'OPEN', 50]);

    const processLotUpdate = updates.find(q => q.sql.includes('UPDATE inventory') && q.params.includes(101));
    assert.deepStrictEqual(processLotUpdate.params, [5, 10, 50, 'CONSUMED', 101]);

    const mpUpdate = updates.find(q => q.sql.includes('UPDATE machine_processes'));
    assert.deepStrictEqual(mpUpdate.params, ['paused', 5, '2023-01-01', null, 10]);

    const machUpdate = updates.find(q => q.sql.includes('UPDATE machines SET status'));
    assert.deepStrictEqual(machUpdate.params, ['paused', 5]);
  });
});
