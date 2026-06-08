require('dotenv').config();
const { primaryPool } = require('./db/pool');
const { reserveCode } = require('./services/codeGeneratorService');
const fs = require('fs');

async function test() {
  let log = "";
  let client;
  try {
    client = await primaryPool.connect();
    log += "Connected to DB\n";
    await client.query('BEGIN');
    log += "Began transaction\n";
    const code = await reserveCode('vendor', client);
    log += "RESERVED CODE: " + code + "\n";
    await client.query('ROLLBACK');
  } catch (err) {
    log += "ERROR: " + err.message + "\n" + err.stack + "\n";
    if (client) await client.query('ROLLBACK');
  } finally {
    if (client) client.release();
    fs.writeFileSync('out_res.txt', log);
    process.exit(0);
  }
}
test();
