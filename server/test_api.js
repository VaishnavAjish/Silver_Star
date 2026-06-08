require('dotenv').config();
const http = require('http');
const jwt = require('jsonwebtoken');

// Generate a valid token for user 1 (super_admin)
const token = jwt.sign({ id: 1, role: 'super_admin', full_name: 'Admin User' }, process.env.JWT_ACCESS_SECRET || require('./config/security').jwt.accessSecret);

async function test() {
  const pool = require('./db/pool');
  const client = await pool.primaryPool.connect();
  
  let machineId, lotId;
  try {
    const { rows: machs } = await client.query("SELECT id FROM machines WHERE status = 'idle' LIMIT 1");
    if (!machs.length) throw new Error('No idle machines');
    machineId = machs[0].id;
    
    const { rows: lots } = await client.query("SELECT id, qty FROM inventory WHERE status IN ('IN STOCK', 'IN PROCESS') AND qty > 0 LIMIT 1");
    if (!lots.length) throw new Error('No valid lots');
    lotId = lots[0].id;
  } finally {
    client.release();
  }

  const reqBody = JSON.stringify({
    machine_id: machineId,
    process_type: 'edge_cut',
    issue_date: '2026-06-03',
    lots: [{ source_lot_id: lotId, issued_qty: 1 }]
  });

  const options = {
    hostname: 'localhost',
    port: process.env.PORT || 5000,
    path: '/api/lot-process-issues',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
      'Content-Length': Buffer.byteLength(reqBody)
    }
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log('Status:', res.statusCode);
      console.log('Response:', data);
    });
  });

  req.on('error', (e) => {
    console.error('Request error:', e.message);
  });

  req.write(reqBody);
  req.end();
}
test();
