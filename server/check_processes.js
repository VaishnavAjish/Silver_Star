require('dotenv').config();
const pool = require('./db/pool');

pool.primaryPool.query("SELECT process_name, process_code, eligible_machine_type FROM process_master")
  .then(res => { console.log(res.rows); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
