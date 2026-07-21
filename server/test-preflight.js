const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgres://postgres:postgres@localhost:5432/silverstar_grow' });

async function run() {
  try {
    const { rows } = await pool.query(`
      SELECT m.id, m.code, m.type, m.status, d.code as dept_code, d.name as dept_name, l.code as loc_code, l.name as loc_name
      FROM machines m
      LEFT JOIN departments d ON m.department_id = d.id
      LEFT JOIN locations l ON m.location_id = l.id
      ORDER BY m.code
    `);
    console.log(JSON.stringify(rows, null, 2));
  } catch(e) {
    console.error("DB Error:", e);
  } finally {
    process.exit(0);
  }
}
run();
