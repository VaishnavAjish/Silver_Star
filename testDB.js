require('dotenv').config({path: 'server/.env'});
console.log('DB:', process.env.DB_HOST);
const pool = require('./server/db/pool');
pool.query('SELECT * FROM lot_process_issues WHERE id = 586').then(r => {
  console.log('Issue:', r.rows[0]);
  if (!r.rows[0]) return process.exit(0);
  return pool.query('SELECT * FROM inventory WHERE id = $1', [r.rows[0].process_lot_id || r.rows[0].source_lot_id]);
}).then(r => {
  if(r) console.log('Lot:', r.rows[0]);
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
