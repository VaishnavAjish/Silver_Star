require('dotenv').config();
const pool = require('./db/pool');

pool.primaryPool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'growth_runs'")
  .then(res => { console.log('growth_runs columns:', res.rows); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
