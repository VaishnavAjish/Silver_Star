/**
 * Migrate inventory table — skips generated columns
 * Run: node migrate_inventory.js
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

// Generated columns that cannot be inserted (auto-computed by DB)
const GENERATED_COLS = new Set(['actual_growth_mm', 'weight_gain', 'growth_pct']);

async function run() {
  console.log('Connecting...');
  const o = await OLD.connect();
  const n = await NEW.connect();

  try {
    // Read all inventory from old server
    const { rows } = await o.query('SELECT * FROM inventory ORDER BY id');
    console.log('Found', rows.length, 'inventory rows on old server');

    if (rows.length === 0) { console.log('Nothing to migrate'); return; }

    // Filter out generated columns
    const allCols = Object.keys(rows[0]);
    const insertCols = allCols.filter(c => !GENERATED_COLS.has(c));
    console.log('Skipping generated cols:', allCols.filter(c => GENERATED_COLS.has(c)).join(', '));
    console.log('Inserting cols:', insertCols.length, 'columns');

    const colList = insertCols.map(c => '"' + c + '"').join(', ');

    await n.query('BEGIN');
    await n.query("SET session_replication_role = 'replica'");
    await n.query('TRUNCATE TABLE inventory RESTART IDENTITY CASCADE');

    let inserted = 0, failed = 0;
    for (const row of rows) {
      const vals = insertCols.map(c => row[c]);
      const ph = vals.map((_, i) => '$' + (i + 1)).join(', ');
      try {
        await n.query(
          'INSERT INTO inventory (' + colList + ') VALUES (' + ph + ') ON CONFLICT DO NOTHING',
          vals
        );
        inserted++;
      } catch (e) {
        console.log('Row error id=' + row.id + ':', e.message);
        failed++;
      }
    }

    await n.query("SET session_replication_role = 'origin'");
    await n.query('COMMIT');

    console.log('\n=== DONE ===');
    console.log('Inserted:', inserted);
    console.log('Failed  :', failed);

    // Verify
    const { rows: verify } = await n.query('SELECT COUNT(*) as c FROM inventory');
    console.log('New RDS inventory count:', verify[0].c);

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
