require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

async function run() {
  try {
    const res = await pool.query(`SELECT * FROM items WHERE code = 'BISCUIT'`);
    console.log("BISCUIT found:", res.rows.length);
    if (res.rows.length === 0) {
      console.log("Inserting BISCUIT...");
      await pool.query(`
        INSERT INTO items (code, name, category, type, default_uom, description, status)
        VALUES ('BISCUIT', 'CVD Growth Run (Biscuit)', 'growth_run', 'finished_good', 'PCS',
                'Physical biscuit produced by a CVD growth process. One row per biscuit.', 'active')
      `);
      console.log("Inserted!");
    } else {
      console.log("BISCUIT data:", res.rows[0]);
    }
  } catch(e) {
    console.error("Error:", e.message);
  } finally {
    pool.end();
  }
}
run();
