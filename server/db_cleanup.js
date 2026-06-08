require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'silverstar_grow',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
});

const KEEP_TABLES = new Set([
  'machines',
  'vendors',
  'accounts',
  'users',
  'items',
  'inventory',
  'migrations_history',
  'roles',
  'user_roles',
  'role_permissions',
  'uom',
  'departments',
  'locations',
  'cost_centers',
  'code_sequences',
  'user_preferences',
  'user_permissions',
  'permission_audit_logs',
  'user_clipboard',
  'login_attempts',
  'customers' // Keeping customers just to be safe as usually people want to keep them with vendors
]);

async function run() {
  try {
    const res = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE';
    `);

    const allTables = res.rows.map(r => r.table_name);
    const tablesToTruncate = allTables.filter(t => !KEEP_TABLES.has(t));

    console.log("Tables to KEEP:", Array.from(KEEP_TABLES).join(', '));
    console.log("Tables to TRUNCATE:", tablesToTruncate.join(', '));

    if (tablesToTruncate.length === 0) {
      console.log("No tables to truncate.");
      return;
    }

    const truncateQuery = `TRUNCATE TABLE ${tablesToTruncate.map(t => `"${t}"`).join(', ')} CASCADE;`;
    console.log("Executing query:", truncateQuery);

    await pool.query(truncateQuery);
    console.log("Successfully truncated all transactional tables!");

  } catch (e) {
    console.error("ERROR:", e);
  } finally {
    process.exit();
  }
}

run();
