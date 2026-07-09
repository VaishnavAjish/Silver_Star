const fs = require('fs');
const path = require('path');
const db = require('./db/pool');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'sql', 'phase48-transfers.sql'), 'utf8');
  try {
    const client = await db.primaryPool.connect();
    await client.query(sql);
    console.log('Migration successful');
    client.release();
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    process.exit(0);
  }
}

migrate();
