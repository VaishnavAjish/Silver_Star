const { Pool } = require('pg');
const pool = new Pool({ user: 'postgres', password: '1', host: '127.0.0.1', database: 'silverstar_grow', port: 5432 });
pool.query(`
  SELECT id, qty, 
  (SELECT COALESCE(SUM(quantity_consumed), 0) FROM lot_movement_parents WHERE parent_lot_id = inventory.id) as qc,
  (SELECT COALESCE(SUM(qty), 0) FROM lot_process_issues WHERE lot_id = inventory.id) as qi
  FROM inventory LIMIT 5
`).then(res => { console.log(JSON.stringify(res.rows)); process.exit(0); }).catch(e => { console.error(e); process.exit(1);});
