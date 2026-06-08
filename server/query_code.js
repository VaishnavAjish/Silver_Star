require('dotenv').config();
const { query } = require('./db/pool');

async function run() {
  try {
    const res = await query("SELECT * FROM code_sequences WHERE entity_type = 'vendor'");
    console.log("ROWS:", res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
run();
