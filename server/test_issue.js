require('dotenv').config();
const pool = require('./db/pool');

async function check() {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    
    // 1. Get an active machine
    const { rows: machs } = await client.query("SELECT id FROM machines WHERE status = 'idle' LIMIT 1");
    if (!machs.length) throw new Error('No idle machines');
    const machineId = machs[0].id;
    
    // 2. Get a valid lot
    const { rows: lots } = await client.query("SELECT id, qty FROM inventory WHERE status IN ('IN STOCK', 'IN PROCESS') AND qty > 0 LIMIT 1");
    if (!lots.length) throw new Error('No valid lots');
    const lotId = lots[0].id;

    console.log('Using Machine:', machineId, 'Lot:', lotId);

    // Call the function directly? No, let's just make the HTTP request or mock the logic
    const reqBody = {
      machine_id: machineId,
      process_type: 'edge_cut',
      issue_date: '2026-06-03',
      lots: [{ source_lot_id: lotId, issued_qty: 1 }]
    };
    
    console.log('Sending body:', JSON.stringify(reqBody));
    
    const http = require('http');
    const options = {
      hostname: 'localhost',
      port: process.env.PORT || 5000,
      path: '/api/lot-process-issues',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Mocking user session since it requires auth. Actually, I can't easily do that without a token.
      }
    };
    
    // Just copy the code block from the route to see where it fails
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    process.exit();
  }
}
check();
