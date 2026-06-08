require('dotenv').config();
const pool = require('./db/pool');

pool.primaryPool.query("SELECT column_default FROM information_schema.columns WHERE table_name = 'process_master' AND column_name = 'process_group'")
  .then(res => { console.log('default:', res.rows[0]); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
