const pool = require('../db/pool');
const { logger } = require('../middleware/logger');
const { reversalBlockReason } = require('./returnRouting');
const { reverseGrowthReturn } = require('./growthReturnReversal');

/**
 * P2 Reversal Orchestrator
 * Dispatches to transaction-specific reversal policies based on authoritative transaction group.
 */
const reversalOrchestrator = {
  /**
   * getReversalEligibility
   * Evaluates if a transaction is eligible for reversal without taking row locks (for UI/preflight).
   */
  async getReversalEligibility(canonicalTxKey, lotId) {
    const parts = (canonicalTxKey || '').split(':');
    if (parts.length < 2) return { can_cancel: false, reason: 'Invalid canonical key format.' };
    let sourceType = parts[0];
    let sourceId = parseInt(parts[1], 10);

    // Resolve lot_op_log → lot_process_return when the op-log row references a return
    if (sourceType === 'lot_op_log') {
      const { rows: opRows } = await pool.query(
        'SELECT lot_id, operation, reference_type, reference_id FROM lot_op_log WHERE id = $1', [sourceId]);
      if (!opRows.length) return { can_cancel: false, reason: 'Transaction not found.' };
      const op = opRows[0];
      if (op.lot_id !== lotId) return { can_cancel: false, reason: 'Cross-lot canonical keys rejected.' };

      // If the op-log row points to a lot_process_return, follow it
      if (op.reference_type === 'lot_process_return' && op.reference_id) {
        sourceType = 'lot_process_return';
        sourceId = op.reference_id;
      } else {
        return { can_cancel: false, reason: 'Safe reversal for this transaction type is not yet available.' };
      }
    }

    // Growth Return reversal eligibility (the only supported reversal type)
    if (sourceType === 'lot_process_return') {
      const returnId = sourceId;
      const { rows: [header] } = await pool.query(`SELECT * FROM lot_process_returns WHERE id = $1`, [returnId]);
      if (!header) return { can_cancel: false, reason: 'Return header not found.' };
      const pre = header.pre_state || null;
      if (!pre || (pre.biscuit.id !== lotId && pre.process_lot.id !== lotId)) {
        return { can_cancel: false, reason: 'Cross-lot canonical keys rejected.' };
      }

      const { rows: [issue] } = await pool.query(`SELECT * FROM lot_process_issues WHERE id = $1`, [header.issue_id]);
      let biscuit = null, machineProcess = null;
      if (pre?.biscuit?.id) {
        const { rows } = await pool.query(`SELECT * FROM inventory WHERE id = $1`, [pre.biscuit.id]);
        biscuit = rows[0] || null;
      }
      if (pre?.biscuit?.machine_process_id) {
        const { rows } = await pool.query(`SELECT * FROM machine_processes WHERE id = $1`, [pre.biscuit.machine_process_id]);
        machineProcess = rows[0] || null;
      }

      // 1. Static state evaluation
      const blocked = reversalBlockReason({ header, pre, issue, biscuit, machineProcess });
      if (blocked) return { can_cancel: false, reason: blocked };

      // 2. Chronological downstream check
      const lotIds = [pre.biscuit.id, pre.process_lot.id];

      const { rows: laterIssues } = await pool.query(
        `SELECT 1 FROM lot_process_issues WHERE source_lot_id = ANY($1::int[]) AND created_at > $2 LIMIT 1`,
        [lotIds, header.created_at]
      );
      if (laterIssues.length) return { can_cancel: false, reason: 'A later process issue (Growth Again / Laser) exists — cannot reverse.' };

      const { rows: laterMoves } = await pool.query(
        `SELECT 1 FROM lot_movement_parents lmp JOIN lot_movements lm ON lm.id = lmp.movement_id
         WHERE lmp.parent_lot_id = ANY($1::int[]) AND lm.movement_date >= $2::date
         UNION ALL
         SELECT 1 FROM lot_movement_children lmc JOIN lot_movements lm ON lm.id = lmc.movement_id
         WHERE lmc.child_lot_id = ANY($1::int[]) AND lm.movement_date >= $2::date LIMIT 1`,
        [lotIds, header.created_at]
      );
      if (laterMoves.length) return { can_cancel: false, reason: 'A later transfer/split/mix movement exists — cannot reverse.' };

      const { rows: laterOps } = await pool.query(
        `SELECT 1 FROM lot_op_log WHERE lot_id = ANY($1::int[]) AND performed_at > $2
         AND NOT (reference_type = 'lot_process_return' AND reference_id = $3) LIMIT 1`,
        [lotIds, header.created_at, header.id]
      );
      if (laterOps.length) return { can_cancel: false, reason: 'Later activity exists on this lot — cannot reverse.' };

      return { can_cancel: true, reason: null };
    }

    return { can_cancel: false, reason: 'Safe reversal for this transaction type is not yet available.' };
  },

  /**
   * reverseTransaction
   * Main entry point for reversing a business transaction.
   * Finds the canonical source and safely re-validates under row locks.
   */
  async reverseTransaction(txInfo) {
    logger.info(`[ReversalOrchestrator] Request to reverse ${txInfo.canonical_transaction_key} by user ${txInfo.userId}`);

    // The canonical key ensures the client isn't dictating the type or rule.
    const parts = (txInfo.canonical_transaction_key || '').split(':');
    if (parts.length < 2) throw new Error('Invalid canonical transaction key.');
    const sourceType = parts[0];
    const sourceId = parseInt(parts[1], 10);

    if (sourceType === 'lot_process_return') {
      const returnId = sourceId;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Dispatch to actual implementation
        const result = await reverseGrowthReturn(client, returnId, txInfo);

        await client.query('COMMIT');
        return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
      } finally {
        client.release();
      }
    }
    throw new Error('Safe reversal for this transaction type is not yet available.');
  }
};

module.exports = reversalOrchestrator;
