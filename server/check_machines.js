require('dotenv').config();
const pool = require('./db/pool');

pool.primaryPool.query('SELECT type, count(*) FROM machines GROUP BY type')
  .then(res => { console.log(res.rows); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
