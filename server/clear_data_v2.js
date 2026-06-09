require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool();
const KEEP = new Set([
  'machines', 'vendors', 'accounts', 'users', 'items', 'locations', 
  'departments', 'cost_centers', 'uom', 'roles', 'user_roles', 
  'role_permissions', 'user_permissions', 'user_preferences', 
  'migrations_history', 'customers'
]);

async function run() {
  const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
  const toTruncate = res.rows.map(r => r.table_name).filter(t => !KEEP.has(t));
  console.log('Truncating:', toTruncate.join(', '));
  if (toTruncate.length > 0) {
    await pool.query('TRUNCATE TABLE "' + toTruncate.join('", "') + '" CASCADE');
  }
  console.log('Done.');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
