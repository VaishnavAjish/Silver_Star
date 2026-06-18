/**
 * Restore users from old server
 * Run: node migrate_users.js
 */
const { Pool } = require('pg');

const OLD = new Pool({
  host: '54.235.46.178', port: 5432,
  database: 'silverstar_grow', user: 'ssg', password: 'Nidhi',
  ssl: false, connectionTimeoutMillis: 15000,
});

const NEW = new Pool({
  host: 'silverstar-db.cufmegkwyay9.us-east-1.rds.amazonaws.com', port: 5432,
  database: 'silverstar_grow', user: 'postgres', password: 'Silverstar2026!',
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000,
});

async function run() {
  console.log('Restoring users from old server...');
  const o = await OLD.connect();
  const n = await NEW.connect();

  try {
    const { rows } = await o.query('SELECT * FROM users ORDER BY id');
    console.log('Found', rows.length, 'users on old server:');
    rows.forEach(u => console.log(' -', u.username, '|', u.email));

    const allCols = Object.keys(rows[0]);
    const colList = allCols.map(c => '"' + c + '"').join(', ');

    await n.query('BEGIN');
    await n.query("SET session_replication_role = 'replica'");

    let inserted = 0;
    for (const row of rows) {
      const vals = allCols.map(c => row[c]);
      const ph = vals.map((_, i) => '$' + (i + 1)).join(', ');
      try {
        await n.query(
          'INSERT INTO users (' + colList + ') VALUES (' + ph + ') ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, is_active = EXCLUDED.is_active',
          vals
        );
        inserted++;
        console.log('Restored:', row.username);
      } catch (e) {
        console.log('Failed user', row.username, ':', e.message);
      }
    }

    await n.query("SET session_replication_role = 'origin'");
    await n.query('COMMIT');
    console.log('\nRestored', inserted, 'users');

    // Show final users
    const { rows: final } = await n.query('SELECT id, username, email, is_active FROM users ORDER BY id');
    console.log('\nUsers now in new RDS:');
    final.forEach(u => console.log(' ', u.id, u.username, u.email, u.is_active ? 'active' : 'inactive'));

  } catch (e) {
    await n.query('ROLLBACK').catch(() => {});
    console.error('FAILED:', e.message);
  } finally {
    o.release();
    n.release();
    await OLD.end();
    await NEW.end();
  }
}

run();
