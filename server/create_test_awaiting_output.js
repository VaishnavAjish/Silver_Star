require('dotenv').config();
const pool = require('./db/pool');
const { createGrowthRun } = require('./services/growthRunService');
const { nextLotOpId } = require('./services/seedLotCodeService');

async function run() {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    const resM = await client.query(`SELECT * FROM machines WHERE status = 'idle' LIMIT 5`);
    if (resM.rows.length === 0) { console.log('No idle machines found.'); return; }
    
    for (let i = 0; i < Math.min(5, resM.rows.length); i++) {
      const machine = resM.rows[i];

      const resP = await client.query(`
        INSERT INTO machine_processes (machine_id, process_type, status, started_at, process_number, target_runtime_hours, expected_rough_qty)
        VALUES ($1, 'growth', 'running', NOW() - INTERVAL '1 day', 'PRC-DEMO-' || LPAD(($2)::text, 3, '0'), 24, 10.5)
        RETURNING id, process_number
      `, [machine.id, Math.floor(Math.random() * 1000)]);
      const processId = resP.rows[0].id;

      const lotOpId = await nextLotOpId(client);

      const seedR = await client.query(`
        INSERT INTO inventory (item_id, lot_number, lot_name, qty, unit, weight, status, source_module, lot_op_id)
        VALUES ((SELECT id FROM items LIMIT 1), 'SEED-DEMO-' || LPAD(($1)::text, 3, '0'), 'Demo Seed', 1, 'PCS', 5.0, 'IN STOCK', 'Testing', $2)
        RETURNING id
      `, [Math.floor(Math.random() * 1000), lotOpId]);
      const seedId = seedR.rows[0].id;

      await client.query(`
        INSERT INTO lot_process_issues (machine_process_id, source_lot_id, issued_qty, issue_number, created_by)
        VALUES ($1, $2, 1, 'ISS-DEMO-' || LPAD(($3)::text, 3, '0'), 1)
      `, [processId, seedId, Math.floor(Math.random() * 1000)]);

      await createGrowthRun(client, processId);

      await client.query(`
        UPDATE machines 
        SET status = 'awaiting_output'
        WHERE id = $1
      `, [machine.id]);

      console.log(`Success! Machine ${machine.code} (${machine.name}) is now awaiting output for process ${resP.rows[0].process_number}.`);
    }

    await client.query('COMMIT');
    console.log('All 5 demo records created successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err);
  } finally {
    client.release();
    process.exit();
  }
}
run();
