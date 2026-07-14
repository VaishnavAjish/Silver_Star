const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const reversalOrchestrator = require('../services/reversalOrchestrator');

describe('Reversal Orchestrator Security & Tampering Checks', () => {
  test('rejects transaction if canonical key is missing or invalid', async () => {
    try {
      await reversalOrchestrator.reverseTransaction({ canonical_transaction_key: '', userId: 1, reason: 'test' });
      assert.fail('Should have thrown an error');
    } catch (err) {
      assert.strictEqual(err.message, 'Invalid canonical transaction key.');
    }
  });

  test('rejects transaction if type is not lot_op_log (unsupported type)', async () => {
    try {
      await reversalOrchestrator.reverseTransaction({ canonical_transaction_key: 'inventory:1', userId: 1, reason: 'test' });
      assert.fail('Should have thrown an error');
    } catch (err) {
      assert.strictEqual(err.message, 'Safe reversal for this transaction type is not yet available.');
    }
  });

  test('getReversalEligibility returns false for invalid key format', async () => {
    const result = await reversalOrchestrator.getReversalEligibility('invalid_key');
    assert.strictEqual(result.can_cancel, false);
    assert.strictEqual(result.reason, 'Invalid canonical key format.');
  });
});
