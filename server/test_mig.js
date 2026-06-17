const pool = require('./db/pool');
const fs = require('fs');

async function test() {
  const client = await pool.primaryPool.connect();
  try {
    const { rows } = await client.query('SELECT filename FROM migrations_history ORDER BY id DESC LIMIT 5');
    fs.writeFileSync('mig_output.json', JSON.stringify(rows, null, 2));
  } catch (err) {
    fs.writeFileSync('mig_output.json', JSON.stringify({ error: err.message }));
  } finally {
    client.release();
    process.exit(0);
  }
}
test();
