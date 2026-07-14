const { reversalBlockReason } = require('./returnRouting');
const { recordGrowthCycle } = require('./growthRunService');

async function logOp(client, lotId, op, refType, refId, qtyDelta, newStatus, notes, userId) {
  await client.query(
    `INSERT INTO lot_op_log (lot_id, operation, reference_type, reference_id, qty_delta, new_status, notes, performed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [lotId, op, refType || null, refId || null, qtyDelta ?? null, newStatus || null, notes || null, userId || null]
  );
}
async function logMachineStatus(client, machineId, oldStatus, newStatus, userId, remarks) {
  await client.query(
    `INSERT INTO machine_status_logs (machine_id, old_status, new_status, changed_by, remarks)
     VALUES ($1,$2,$3,$4,$5)`,
    [machineId, oldStatus, newStatus, userId, remarks || null]
  );
}

/**
 * Reverses a full usable Growth Return safely under locks.
 */
async function reverseGrowthReturn(client, returnId, txInfo) {
  // We are securely on the return-usable growth return path. Run the locking logic!
  const { rows: [header] } = await client.query(`SELECT * FROM lot_process_returns WHERE id = $1 FOR UPDATE`, [returnId]);
  if (!header) throw new Error('Return not found.');
  const pre = header.pre_state || null;
  if (!pre || pre.version !== 2) {
    throw new Error('Legacy or incomplete return records cannot be reversed safely. Please correct manually.');
  }

  if (!pre.biscuit || !pre.process_lot || !pre.issue) {
    throw new Error('Incomplete pre_state snapshot: missing core entities.');
  }

  if (String(pre.biscuit.id) !== String(txInfo.lotId) && String(pre.process_lot.id) !== String(txInfo.lotId)) {
    throw new Error('Cross-lot canonical keys rejected.');
  }

  const { rows: [issue] } = await client.query(`SELECT * FROM lot_process_issues WHERE id = $1 FOR UPDATE`, [header.issue_id]);
  if (!issue) throw new Error('Missing issue row.');

  const { rows: biscuitRows } = await client.query(`SELECT * FROM inventory WHERE id = $1 FOR UPDATE`, [pre.biscuit.id]);
  const biscuit = biscuitRows[0];
  if (!biscuit) throw new Error('Missing biscuit row.');

  let machineProcess = null;
  if (pre.biscuit.machine_process_id) {
    if (!pre.machine_process) throw new Error('Incomplete pre_state snapshot: missing machine_process.');
    const { rows } = await client.query(`SELECT * FROM machine_processes WHERE id = $1 FOR UPDATE`, [pre.biscuit.machine_process_id]);
    machineProcess = rows[0];
    if (!machineProcess) throw new Error('Missing machine_process row.');
  }

  if (pre.issue.machine_id && !pre.machine) {
    throw new Error('Incomplete pre_state snapshot: missing machine.');
  }

  const blocked = reversalBlockReason({ header, pre, issue, biscuit, machineProcess });
  if (blocked) throw new Error(blocked);

  const lotIds = [pre.biscuit.id, pre.process_lot.id];
  const { rows: laterIssues } = await client.query(
    `SELECT 1 FROM lot_process_issues WHERE source_lot_id = ANY($1::int[]) AND created_at > $2 LIMIT 1`,
    [lotIds, header.created_at]);
  if (laterIssues.length) throw new Error('A later process issue (Growth Again / Laser) exists — cannot reverse.');

  const { rows: laterMoves } = await client.query(
    `SELECT 1 FROM lot_movement_parents lmp JOIN lot_movements lm ON lm.id = lmp.movement_id
     WHERE lmp.parent_lot_id = ANY($1::int[]) AND lm.created_at > $2
     UNION ALL
     SELECT 1 FROM lot_movement_children lmc JOIN lot_movements lm ON lm.id = lmc.movement_id
     WHERE lmc.child_lot_id = ANY($1::int[]) AND lm.created_at > $2 LIMIT 1`,
    [lotIds, header.created_at]);
  if (laterMoves.length) throw new Error('A later transfer/split/mix movement exists — cannot reverse.');

  const { rows: laterOps } = await client.query(
    `SELECT 1 FROM lot_op_log WHERE lot_id = ANY($1::int[]) AND performed_at > $2
     AND operation NOT IN ('remarks_added', 'viewed', 'printed')
     AND NOT (reference_type = 'lot_process_return' AND reference_id = $3) LIMIT 1`,
    [lotIds, header.created_at, header.id]);
  if (laterOps.length) throw new Error('Later activity exists on this lot — cannot reverse.');

  // Immutable mark
  await client.query(
    `UPDATE lot_process_returns SET status = 'REVERSED', reversed_by = $1, reversed_at = NOW(), reversal_reason = $2 WHERE id = $3`,
    [txInfo.userId, txInfo.reason, header.id]);

  // Restore issue exactly
  await client.query(
    `UPDATE lot_process_issues SET remaining_in_process = $1, status = $2, updated_at = NOW() WHERE id = $3`,
    [pre.issue.remaining_in_process, pre.issue.status, issue.id]);

  // Restore process lot exactly
  await client.query(
    `UPDATE inventory SET qty = $1, weight = $2, total_value = $3, status = $4, updated_at = NOW() WHERE id = $5`,
    [pre.process_lot.qty, pre.process_lot.weight, pre.process_lot.total_value, pre.process_lot.status, pre.process_lot.id]);

  // Restore biscuit exactly (no run_no increment, preserve genealogy)
  const isDiff = (a, b) => Math.abs((parseFloat(a) || 0) - (parseFloat(b) || 0)) > 0.0001;
  const measurementsChanged = isDiff(biscuit.weight, pre.biscuit.weight) ||
    isDiff(biscuit.dim_length, pre.biscuit.dim_length) ||
    isDiff(biscuit.dim_depth, pre.biscuit.dim_depth) ||
    isDiff(biscuit.dim_height, pre.biscuit.dim_height);

  await client.query(
    `UPDATE inventory SET status = $1, weight = $2, dim_length = $3, dim_depth = $4,
     dim_height = $5, dim_unit = $6, updated_at = NOW() WHERE id = $7`,
    [pre.biscuit.status, pre.biscuit.weight, pre.biscuit.dim_length, pre.biscuit.dim_depth, pre.biscuit.dim_height, pre.biscuit.dim_unit, pre.biscuit.id]);

  // Exact machine process restoration
  if (pre.machine_process) {
    await client.query(
      `UPDATE machine_processes SET status = $1, total_paused_minutes = $2, paused_at = $3, completed_at = $4 WHERE id = $5`,
      [pre.machine_process.status, pre.machine_process.total_paused_minutes, pre.machine_process.paused_at, pre.machine_process.completed_at, pre.machine_process.id]
    );
  }

  // Exact machine restoration
  if (pre.machine) {
    const { rows: [mach] } = await client.query(`SELECT status FROM machines WHERE id = $1 FOR UPDATE`, [pre.machine.id]);
    if (mach && mach.status !== pre.machine.status) {
      await client.query(`UPDATE machines SET status = $1 WHERE id = $2`, [pre.machine.status, pre.machine.id]);
      await logMachineStatus(client, pre.machine.id, mach.status, pre.machine.status, txInfo.userId, `Growth Return ${header.return_number} reversed — exact status restored`);
    }
  }

  // Audit log reversal
  await logOp(client, pre.biscuit.id, 'return_reversed', 'lot_process_return', header.id, 0, pre.biscuit.status,
    `Growth Return ${header.return_number} REVERSED by admin — ${txInfo.reason}`, txInfo.userId);
  await logOp(client, pre.process_lot.id, 'return_reversed', 'lot_process_return', header.id, pre.process_lot.qty, pre.process_lot.status,
    `Growth Return ${header.return_number} REVERSED — process lot restored`, txInfo.userId);

  // Measurements log
  if (measurementsChanged) {
    await recordGrowthCycle(client, {
      growthRunId: pre.biscuit.id,
      machineProcessId: pre.biscuit.machine_process_id || null,
      processType: issue.process_type || null,
      prevHeight: biscuit.dim_height, newHeight: pre.biscuit.dim_height,
      prevWeight: biscuit.weight, newWeight: pre.biscuit.weight,
      dimLength: pre.biscuit.dim_length, dimWidth: pre.biscuit.dim_depth,
      dimUnit: pre.biscuit.dim_unit || 'mm',
      remarks: `REVERSAL of ${header.return_number}: ${txInfo.reason}`,
      performedBy: txInfo.userId,
    });
  }

  return { message: 'Reversal successful' };
}

module.exports = { reverseGrowthReturn };
