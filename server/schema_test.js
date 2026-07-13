const { Pool } = require('pg');
const pool = new Pool({
  host: 'localhost',
  port: 5433,
  user: 'postgres',
  password: '1',
  database: 'silverstar_grow'
});

async function run() {
  try {
    const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'inventory'");
    console.log(JSON.stringify(res.rows, null, 2));
  } catch(e) {
    console.error("error:", e);
  } finally {
    pool.end();
  }
}
run();
