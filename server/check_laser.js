require('dotenv').config();
const pool = require('./db/pool');

pool.primaryPool.query("SELECT id, code, name, type FROM machines WHERE type = 'Laser'")
  .then(res => { console.log(res.rows); process.exit(0); })
  .catch(err => { console.error(err); process.exit(1); });
