const { Pool } = require('pg');
const pool = new Pool({ host: '192.168.1.211', port: 5433, database: 'silverstar_grow', user: 'postgres', password: 'Nidhi', ssl: false });

(async () => {
  try {
    const c = await pool.connect();
    const r = await c.query('SELECT id, lot_code, lot_number, item_id FROM inventory WHERE id IN (220, 1, 2) ORDER BY id');
    console.log('Found rows:', r.rows.length);
    r.rows.forEach(row => console.log(JSON.stringify(row)));
    
    if (r.rows.length === 0) {
      // Check a few recent IDs
      const r2 = await c.query('SELECT id, lot_code FROM inventory ORDER BY id DESC LIMIT 5');
      console.log('Most recent inventory entries:');
      r2.rows.forEach(row => console.log('  id=' + row.id + ' lot_code=' + row.lot_code));
    }
    
    c.release();
    await pool.end();
  } catch (e) {
    console.error('Error:', e.message);
  }
})();
