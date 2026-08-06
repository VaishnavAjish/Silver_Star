const { Pool } = require('pg');

const pool = new Pool({
  host: '54.235.46.178',
  user: 'ssg',
  password: 'Nidhi',
  database: 'silverstar_grow',
  ssl: false
});

async function run() {
  try {
    const res = await pool.query(`
      SELECT i.id, i.lot_number, i.status, i.qty, i.weight, i.dim_l, i.dim_w, i.dim_d, it.name as item_name
      FROM inventory i
      LEFT JOIN items it ON i.item_id = it.id
      WHERE i.lot_number LIKE 'SSD109-APR26-021%'
    `);
    require('fs').writeFileSync('out.txt', JSON.stringify(res.rows, null, 2));
  } catch (e) {
    require('fs').writeFileSync('out.txt', String(e));
  } finally {
    pool.end();
  }
}

run();
