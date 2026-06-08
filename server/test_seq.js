require('dotenv').config();
const pool = require('./db/pool');
const { nextMfgProcessNumber } = require('./services/seedLotCodeService');

async function test() {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    const num = await nextMfgProcessNumber(client);
    console.log('Next Mfg Process Number:', num);
    await client.query('ROLLBACK');
  } catch (err) {
    console.error('Error generating mfg process number:', err.message);
  } finally {
    client.release();
    process.exit();
  }
}
test();
