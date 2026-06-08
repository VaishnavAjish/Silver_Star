require('dotenv').config();
const { query } = require('./db/pool');
const fs = require('fs');

async function test() {
  try {
    const res = await query(`SELECT mp.process_type, pm.process_group FROM machine_processes mp LEFT JOIN process_master pm ON pm.process_code = mp.process_type WHERE mp.id = 74`);
    fs.writeFileSync('out_74.txt', JSON.stringify(res.rows));
  } catch (e) {
    fs.writeFileSync('out_74.txt', e.message);
  }
  process.exit(0);
}
test();
