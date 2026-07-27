const fs = require('fs');
const path = require('path');
const dotenvPath = path.join(__dirname, 'server', '.env');
require(path.join(__dirname, 'server', 'node_modules', 'dotenv')).config({ path: dotenvPath });

const { primaryPool } = require('./server/db/pool');

async function run() {
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'server', 'migrations', 'phase85_control_tower_enabled.sql'), 'utf8');
    await primaryPool.query(sql);
    console.log('Migration done successfully');
  } catch (e) {
    console.error('Migration failed:', e);
  } finally {
    process.exit(0);
  }
}

run();
