// One-off: apply ONLY phase41 (cost centre) as a POSTGRES SUPERUSER, because the
// app user (ssg) does not own the tables and cannot ALTER them. Also grants the
// app user rights on the new audit table. Idempotent. Delete after use.
//
// RUN (PowerShell), substituting your postgres password:
//   $env:PG_ADMIN_URL = "postgresql://postgres:YOURPASSWORD@54.235.46.178:5432/silverstar_grow"
//   & "C:\Program Files\nodejs\node.exe" _apply_cc.js
//
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const adminUrl = process.env.PG_ADMIN_URL;
if (!adminUrl) {
  console.error('Set PG_ADMIN_URL to a postgres-superuser connection string first.');
  process.exit(1);
}

const appUser = process.env.DB_USER || 'ssg';
const useSsl = process.env.DB_SSL === 'true'
  ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
  : false;

const pool = new Pool({ connectionString: adminUrl, ssl: useSsl });

(async () => {
  const file = path.join(__dirname, 'migrations', 'phase41-cost-center-foundation.sql');
  const sql = fs.readFileSync(file, 'utf8');
  const stmts = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);

  for (const s of stmts) {
    await pool.query(s);
  }

  // Grant the app user access to the newly created audit table + its sequence.
  await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_center_audit TO ${appUser}`);
  await pool.query(`GRANT USAGE, SELECT ON SEQUENCE public.cost_center_audit_id_seq TO ${appUser}`);

  await pool.query(
    `INSERT INTO migrations_history (filename) VALUES ('phase41-cost-center-foundation.sql')
     ON CONFLICT (filename) DO NOTHING`
  );

  const col = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name='fixed_assets' AND column_name='cost_center_id'"
  );
  const audit = await pool.query("SELECT to_regclass('public.cost_center_audit') AS t");
  const seeds = await pool.query("SELECT code FROM cost_centers WHERE code IN ('CC001','CC002','CC003') ORDER BY code");

  console.log('phase41 applied OK as superuser');
  console.log('fixed_assets.cost_center_id exists:', col.rows.length > 0);
  console.log('cost_center_audit table:', audit.rows[0].t);
  console.log('granted to app user:', appUser);
  console.log('seed codes present:', seeds.rows.map(r => r.code).join(',') || '(none)');
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
