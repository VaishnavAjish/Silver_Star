/**
 * FULL DATA RE-MIGRATION SCRIPT (v2 — per-table transactions + column safety)
 * Source: 54.235.46.178  user=ssg  password=Nidhi  db=silverstar_grow
 * Target: AWS RDS         user=postgres  password=Silverstar2026!  db=silverstar_grow
 *
 * Run from ~/apps/backend/server:
 *   node full_remigrate.js
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

const SKIP = new Set([
  'users','refresh_tokens','login_attempts','sys_event_outbox','sessions',
  'role_permissions','roles','user_roles','audit_log','api_logs',
]);

// Get columns that exist in a specific table on a given client
async function getColumns(client, table) {
  const { rows } = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    ORDER BY ordinal_position
  `, [table]);
  return new Set(rows.map(r => r.column_name));
}

async function migrateTable(oldClient, table, tableData) {
  // Get a fresh connection for each table (avoids aborted transaction state)
  const newClient = await NEW.connect();
  try {
    const rowCount = tableData[table];
    process.stdout.write(`   ${table} (${rowCount} rows)... `);

    // Get columns from both sides — use intersection to avoid schema mismatches
    const oldCols = await getColumns(oldClient, table);
    const newCols = await getColumns(newClient, table);
    const commonCols = [...oldCols].filter(c => newCols.has(c));

    if (commonCols.length === 0) {
      console.log('⚠️  No common columns — skipped');
      return { inserted: 0, failed: rowCount };
    }

    // Read rows from old server (only common columns)
    const colSelect = commonCols.map(c => `"${c}"`).join(', ');
    const { rows } = await oldClient.query(
      `SELECT ${colSelect} FROM "${table}" ORDER BY id NULLS LAST`
    );

    if (rows.length === 0) { console.log('(empty)'); return { inserted: 0, failed: 0 }; }

    const colList = commonCols.map(c => `"${c}"`).join(', ');
    let inserted = 0, failed = 0;

    // Each table in its own transaction with per-row SAVEPOINTs
    await newClient.query('BEGIN');
    await newClient.query("SET session_replication_role = 'replica'");
    await newClient.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);

    for (const row of rows) {
      const vals = commonCols.map(c => row[c]);
      const ph = vals.map((_, i) => `$${i + 1}`).join(', ');
      try {
        await newClient.query('SAVEPOINT sp1');
        await newClient.query(
          `INSERT INTO "${table}" (${colList}) VALUES (${ph}) ON CONFLICT DO NOTHING`,
          vals
        );
        await newClient.query('RELEASE SAVEPOINT sp1');
        inserted++;
      } catch (e) {
        await newClient.query('ROLLBACK TO SAVEPOINT sp1');
        failed++;
      }
    }

    await newClient.query("SET session_replication_role = 'origin'");
    await newClient.query('COMMIT');

    const status = inserted === rows.length ? '✅' : inserted > 0 ? '⚠️ ' : '❌';
    console.log(`${status} ${inserted}/${rows.length} inserted${failed > 0 ? `, ${failed} skipped` : ''}`);
    return { inserted, failed };

  } catch (e) {
    await newClient.query('ROLLBACK').catch(() => {});
    console.log(`❌ Error: ${e.message}`);
    return { inserted: 0, failed: tableData[table] };
  } finally {
    newClient.release();
  }
}

async function migrate() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  SILVERSTAR GROW — Full Data Re-Migration v2');
  console.log('  Source: 54.235.46.178  →  Target: AWS RDS');
  console.log('═══════════════════════════════════════════════════\n');

  const oldClient = await OLD.connect();

  try {
    // Step 1: Get all tables with data from old server
    const { rows: tbls } = await oldClient.query(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`
    );
    const tables = tbls.map(r => r.tablename).filter(t => !SKIP.has(t));

    console.log('📊 Old server data:');
    const tableData = {};
    for (const t of tables) {
      try {
        const { rows } = await oldClient.query(`SELECT COUNT(*) as c FROM "${t}"`);
        tableData[t] = parseInt(rows[0].c);
        if (tableData[t] > 0) console.log(`   ${t.padEnd(40)} ${tableData[t]} rows`);
      } catch (_) { tableData[t] = 0; }
    }

    const withData = tables.filter(t => tableData[t] > 0);
    console.log(`\n   ${withData.length} tables to migrate\n`);

    // Step 2: Migrate each table independently
    console.log('⬆️  Migrating tables...\n');
    let totalIns = 0, totalFail = 0;

    for (const table of withData) {
      const { inserted, failed } = await migrateTable(oldClient, table, tableData);
      totalIns += inserted;
      totalFail += failed;
    }

    // Step 3: Reset sequences
    console.log('\n🔄 Resetting sequences...');
    const seqClient = await NEW.connect();
    try {
      const { rows: seqs } = await seqClient.query(
        `SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public'`
      );
      for (const { sequence_name } of seqs) {
        const tbl = sequence_name.replace(/_id_seq$/, '');
        await seqClient.query(
          `SELECT setval('${sequence_name}', COALESCE((SELECT MAX(id) FROM "${tbl}"), 1))`
        ).catch(() => {});
      }
      console.log('   ✅ Done\n');
    } finally { seqClient.release(); }

    console.log('═══════════════════════════════════════════════════');
    console.log(`  ✅ Migration Complete!`);
    console.log(`  📊 Inserted: ${totalIns}   Skipped: ${totalFail}`);
    console.log('═══════════════════════════════════════════════════\n');

    // Step 4: Verify
    console.log('📋 Verification (new RDS):');
    const verClient = await NEW.connect();
    try {
      for (const t of withData) {
        const { rows } = await verClient.query(`SELECT COUNT(*) as c FROM "${t}"`);
        const c = parseInt(rows[0].c);
        if (c > 0) console.log(`   ${t.padEnd(40)} ${c} rows ✅`);
      }
    } finally { verClient.release(); }

  } finally {
    oldClient.release();
    await OLD.end();
    await NEW.end();
  }
}

migrate().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
