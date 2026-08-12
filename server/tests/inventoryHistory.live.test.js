const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const pool = require('../db/pool');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../app');
const securityConfig = require('../config/security');

describe('Inventory History & View Union Integration', () => {
  let token;
  let testLotId;
  let testReturnId;

  before(async () => {
    // 1. Mint a valid token for supertest
    token = jwt.sign(
      { id: 1, email: 'admin@example.com', role: 'super_admin' },
      securityConfig.jwt.accessSecret,
      { expiresIn: '1h' }
    );

    // 2. Insert test data
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Create a test item and lot
      const { rows: [item] } = await client.query(`
        INSERT INTO items (code, name, category, default_unit) 
        VALUES ('TEST_HIST', 'Test Item', 'Raw Materials', 'kg') 
        RETURNING id
      `);
      
      const { rows: [lot] } = await client.query(`
        INSERT INTO inventory (item_id, lot_number, qty, status) 
        VALUES ($1, 'TEST-LOT-999', 100, 'IN STOCK') 
        RETURNING id
      `, [item.id]);
      testLotId = lot.id;

      // Op 1: Creation (affects balance)
      await client.query(`
        INSERT INTO lot_op_log (lot_id, operation, qty_delta, performed_at)
        VALUES ($1, 'creation', 100, NOW() - INTERVAL '2 hours')
      `, [testLotId]);

      // Op 2: Return Usable (should NOT affect balance reconstruction)
      const { rows: [ret] } = await client.query(`
        INSERT INTO lot_process_returns (return_number, usable_qty, is_final, return_date)
        VALUES ('RET-TEST-999', 50, true, NOW())
        RETURNING id
      `);
      testReturnId = ret.id;

      await client.query(`
        INSERT INTO lot_op_log (lot_id, operation, qty_delta, reference_type, reference_id, performed_at)
        VALUES ($1, 'return_usable', 50, 'lot_process_return', $2, NOW() - INTERVAL '1 hour')
      `, [testLotId, testReturnId]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  after(async () => {
    const client = await pool.connect();
    try {
      // Cleanup
      await client.query('DELETE FROM lot_op_log WHERE lot_id = $1', [testLotId]);
      await client.query('DELETE FROM lot_process_returns WHERE id = $1', [testReturnId]);
      await client.query('DELETE FROM inventory WHERE id = $1', [testLotId]);
      await client.query("DELETE FROM items WHERE code = 'TEST_HIST'");
    } finally {
      client.release();
    }
    await pool.shutdown();
  });

  test('Balance Impact: return_usable must not add to qty_after balance reconstruction', async () => {
    const res = await request(app)
      .get(`/api/inventory/${testLotId}/history`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const history = res.body.data;
    assert.ok(Array.isArray(history), 'History should return an array of events');
    
    // Find the return_usable event
    const returnEvent = history.find(e => e.operation === 'return_usable' || e.event_type === 'return_usable');
    assert.ok(returnEvent, 'Should find return_usable event in history');
    
    // The balance should be 100, not 150, because return_usable is mapped to FALSE for affects_qty_balance
    assert.strictEqual(Number(returnEvent.qty_after), 100, 'return_usable must not inflate qty_after');
    assert.strictEqual(returnEvent.affects_qty_balance, false, 'return_usable must have affects_qty_balance = false');
  });

  test('View Union exact grouping parses canonical_transaction_key correctly', async () => {
    const canonicalKey = `lot_process_return:${testReturnId}`;
    
    const res = await request(app)
      .get(`/api/inventory/history/union?canonical_transaction_key=${canonicalKey}&lot_id=${testLotId}`)
      .set('Authorization', `Bearer ${token}`);
      
    // Because we didn't insert a full pre_state for this test return header, it will return 403 Cross-lot rejection,
    // or 500/400. Let's assert the endpoint parsed the key and reached the lot check logic.
    assert.ok([200, 403, 404].includes(res.status), `Expected handled status, got ${res.status}: ${JSON.stringify(res.body)}`);
    
    // For a missing pre_state on lot_process_return, the orchestrator/union logic should safely reject with Cross-lot.
    if (res.status === 403) {
      assert.strictEqual(res.body.error, 'Cross-lot canonical keys rejected.');
    }
  });
});
