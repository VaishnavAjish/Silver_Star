require('dotenv').config();
const pool = require('./db/pool');

pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'inventory'").then(r => {
  console.log(r.rows.map(row => row.column_name));
  process.exit(0);
});
