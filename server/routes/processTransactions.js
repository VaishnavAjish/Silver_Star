const express = require('express');
const pool = require('../db/pool');
const journalEngine = require('../services/journalEngine');
const { authenticate, authorize } = require('../middleware/auth');
const { dispatchEvent } = require('../services/eventDispatcher');
const { getCostCenterIdForDepartment } = require('../services/departmentService');
const FinancialMappingService = require('../services/FinancialMappingService');

const router = express.Router();

// GET /api/process-transactions/seeds-in-process
router.get('/seeds-in-process', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT inv.*, i.name as item_name, i.code as item_code
       FROM inventory inv JOIN items i ON inv.item_id = i.id
       WHERE inv.status = 'IN PROCESS' AND i.category = 'seed'
       ORDER BY inv.lot_number`
    );
    res.json(result.rows);
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[processTransactions.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// GET /api/process-transactions
router.get('/', authenticate, async (req, res) => {
  try {
    const { trs_type, status } = req.query;
    let q = `SELECT pt.*, m.name as machine_name, d.name as dept_name
             FROM process_transactions pt
             LEFT JOIN machines m ON pt.machine_id = m.id
             LEFT JOIN departments d ON pt.department_id = d.id WHERE 1=1`;
    const params = [];
    if (trs_type) { params.push(trs_type); q += ` AND pt.trs_type = $${params.length}`; }
    if (status) { params.push(status); q += ` AND pt.status = $${params.length}`; }
    q += ' ORDER BY pt.trs_date DESC, pt.id DESC LIMIT 200';
    const result = await pool.query(q, params);
    res.json({ data: result.rows, total: result.rows.length });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[processTransactions.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// GET /api/process-transactions/:id (with lines)
router.get('/:id', authenticate, async (req, res) => {
  try {
    const pt = await pool.query(
      `SELECT pt.*, m.name as machine_name FROM process_transactions pt LEFT JOIN machines m ON pt.machine_id = m.id WHERE pt.id = $1`,
      [req.params.id]
    );
    if (pt.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const lines = await pool.query('SELECT * FROM process_transaction_lines WHERE process_trs_id = $1 ORDER BY id', [req.params.id]);
    res.json({ ...pt.rows[0], lines: lines.rows });
  } catch (err) { require('fs').writeFileSync('global_500_err.txt', '[processTransactions.js] ' + req.path + '\n' + err.message + '\n' + err.stack); res.status(500).json({ error: err.message }); }
});

// POST /api/process-transactions/send  [DEPRECATED — Phase 27]
// New process engine: POST /api/lot-process-issues
router.post('/send', authenticate, authorize('admin', 'operator'), (req, res) => {
  return res.status(410).json({
    error: 'This process engine is deprecated. Use /api/lot-process-issues to issue lots to process.',
    deprecated: true,
    replacement: '/api/lot-process-issues',
  });
});
router.post('/_send_legacy', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const { trs_date, process_name, machine_id, department_id, worker_name,
            expected_return, priority, remark, parameters, lines } = req.body;

    if (!lines || lines.length === 0) throw new Error('At least one item required');

    const seqR = await client.query("SELECT nextval('ps_seq') as num");
    const trsNumber = `PS-${seqR.rows[0].num}`;

    let totalQty = 0, totalWt = 0;
    for (const line of lines) {
      totalQty += parseFloat(line.qty_in) || 0;
      totalWt += parseFloat(line.wt_in) || 0;
    }

    // Insert header
    const ptR = await client.query(
      `INSERT INTO process_transactions (trs_number, trs_type, trs_date, process_name, machine_id,
        department_id, worker_name, expected_return, priority, remark, parameters,
        total_qty_in, total_wt_in, status, created_by)
       VALUES ($1,'send',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'OPEN',$13) RETURNING *`,
      [trsNumber, trs_date, process_name, machine_id || null, department_id || null,
       worker_name, expected_return || null, priority || 'Normal', remark,
       JSON.stringify(parameters || {}), totalQty, totalWt, req.user.id]
    );
    const pt = ptR.rows[0];

    // Insert lines and update inventory status
    for (const line of lines) {
      await client.query(
        `INSERT INTO process_transaction_lines (process_trs_id, inventory_id, lot_number, lot_name, item_type, qty_in, wt_in)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [pt.id, line.inventory_id || null, line.lot_number, line.lot_name, line.item_type, line.qty_in, line.wt_in]
      );
      // Update inventory status to IN PROCESS
      if (line.inventory_id) {
        await client.query("UPDATE inventory SET status = 'IN PROCESS', last_used = $1 WHERE id = $2", [trs_date, line.inventory_id]);
      }
    }

    // JE: Capitalize raw material directly to WIP (Growth Run Inventory)
    const wipAccId = await FinancialMappingService.resolveInventoryAccount('wip', client);
    const rawAccId = await FinancialMappingService.resolveInventoryAccount('seed', client); // Assumes seed as default raw material for process

    if (wipAccId && rawAccId && totalWt > 0) {
      // Calculate value from inventory records
      let totalValue = 0;
      for (const line of lines) {
        if (line.inventory_id) {
          const invR = await client.query('SELECT total_value FROM inventory WHERE id = $1', [line.inventory_id]);
          totalValue += parseFloat(invR.rows[0]?.total_value) || 0;
        }
      }
      if (totalValue > 0) {
        const je = await journalEngine.createEntry({
          date: trs_date,
          description: `Send to ${process_name} - ${trsNumber}`,
          sourceType: 'process_send',
          sourceId: pt.id,
          lines: [
            { accountId: wipAccId, debit: totalValue, credit: 0, narration: `WIP: ${process_name}` },
            { accountId: rawAccId, debit: 0, credit: totalValue, narration: `Seeds sent to process` },
          ],
          autoPost: true,
          createdBy: req.user.id,
        });
        await client.query('UPDATE process_transactions SET je_id = $1 WHERE id = $2', [je.id, pt.id]);
      }
    }

    await client.query('COMMIT');

    // Real-Time: process started
    dispatchEvent('process.started', {
      id: pt.id, trs_number: trsNumber, process_name,
      lines_count: lines.length, created_by: req.user.id,
    });

    res.status(201).json(pt);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

// POST /api/process-transactions/return  [DEPRECATED — Phase 27]
// New process engine: POST /api/lot-process-issues/:id/return
router.post('/return', authenticate, authorize('admin', 'operator'), (req, res) => {
  return res.status(410).json({
    error: 'This process engine is deprecated. Use /api/lot-process-issues/:id/return to record a process return.',
    deprecated: true,
    replacement: '/api/lot-process-issues/:id/return',
  });
});
router.post('/_return_legacy', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const { trs_date, send_ref_id, process_name, machine_id, department_id,
            return_status, remark, parameters, lines } = req.body;

    const seqR = await client.query("SELECT nextval('pr_seq') as num");
    const trsNumber = `PR-${seqR.rows[0].num}`;

    let totalQtyIn = 0, totalWtIn = 0, totalQtyOut = 0, totalWtOut = 0;
    for (const line of lines) {
      totalQtyIn += parseFloat(line.qty_in) || 0;
      totalWtIn += parseFloat(line.wt_in) || 0;
      totalQtyOut += parseFloat(line.qty_out) || 0;
      totalWtOut += parseFloat(line.wt_out) || 0;
    }

    const ptR = await client.query(
      `INSERT INTO process_transactions (trs_number, trs_type, trs_date, process_name, machine_id,
        department_id, send_ref_id, return_status, remark, parameters,
        total_qty_in, total_wt_in, total_qty_out, total_wt_out, status, created_by)
       VALUES ($1,'return',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'COMPLETED',$14) RETURNING *`,
      [trsNumber, trs_date, process_name, machine_id || null, department_id || null,
       send_ref_id || null, return_status || 'Completed', remark,
       JSON.stringify(parameters || {}), totalQtyIn, totalWtIn, totalQtyOut, totalWtOut, req.user.id]
    );
    const pt = ptR.rows[0];

    // Insert lines and handle inventory status
    for (const line of lines) {
      const yieldPct = (parseFloat(line.wt_in) || 0) > 0
        ? Math.round(((parseFloat(line.wt_out) || 0) / (parseFloat(line.wt_in) || 1)) * 10000) / 100
        : 0;

      await client.query(
        `INSERT INTO process_transaction_lines (process_trs_id, inventory_id, lot_number, lot_name, item_type,
          qty_in, wt_in, qty_out, wt_out, yield_pct, next_process, remark)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [pt.id, line.inventory_id || null, line.lot_number, line.lot_name, line.item_type,
         line.qty_in, line.wt_in, line.qty_out, line.wt_out, yieldPct,
         line.next_process || null, line.remark]
      );

      // If next_process = 'Consumed' or 'Rejected', mark seed as consumed
      if (line.inventory_id && ['Consumed', 'Rejected'].includes(line.next_process)) {
        await client.query("UPDATE inventory SET status = 'CONSUMED' WHERE id = $1", [line.inventory_id]);
      }
    }

    // Update send transaction status
    if (send_ref_id) {
      await client.query("UPDATE process_transactions SET status = 'COMPLETED' WHERE id = $1", [send_ref_id]);
    }

    await client.query('COMMIT');

    // Real-Time: process completed / returned
    dispatchEvent('process.completed', {
      id: pt.id, trs_number: trsNumber, process_name, return_status,
      created_by: req.user.id,
    });

    res.status(201).json(pt);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ error: err.message });
  } finally { client.release(); }
});

module.exports = router;
