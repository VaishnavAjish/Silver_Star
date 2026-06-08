require('dotenv').config();
const pool = require('./config/db');
pool.query('SELECT name FROM locations').then(r=>{
  console.log(JSON.stringify(r.rows));
  process.exit(0);
}).catch(e=>{
  console.error(e);
  process.exit(1);
});
