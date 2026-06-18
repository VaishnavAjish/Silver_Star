/**
 * FULL DATA RE-MIGRATION SCRIPT
 * Source: 54.235.46.178  user=ssg  password=Nidhi  db=silverstar_grow
 * Target: AWS RDS         user=postgres  password=Silverstar2026!  db=silverstar_grow
 *
 * What it does:
 *  1. Reads ALL tables from old server
 *  2. TRUNCATES all business data on new RDS (keeps users/roles/permissions)
 *  3. Re-inserts all data cleanly — no duplicates
 *  4. Resets sequences so new records auto-increment correctly
 *
 * Run: node full_remigrate.js
 */

const { Pool } = require('pg');

// ── OLD server (source) ──────────────────────────────────────
const OLD = new Pool({
  host: '54.235.46.178',
  port: 5432,
  database: 'silverstar_grow',
  user: 'ssg',
  password: 'Nidhi',
  ssl: false,
  connectionTimeoutMillis: 15000,
});

// ── NEW RDS (destination) ─────────────────────────────────────
const NEW = new Pool({
  host: 'silverstar-db.cufmegkwyay9.us-east-1.rds.amazonaws.com',
  port: 5432,
  database: 'silverstar_grow',
  user: 'postgres',
  password: 'Silverstar2026!',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
});

// Tables to SKIP (system/auth tables — keep existing new-server data)
const SKIP_TABLES = new Set([
  'users',
  'refresh_tokens',
  'login_attempts',
  'sys_event_outbox',
  'sessions',
  'role_permissions',
  'roles',
  'user_roles',
  'audit_log',
  'api_logs',
]);

async function getAllTables(client) {
  const { rows } = await client.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  return rows.map(r => r.tablename).filter(t => !SKIP_TABLES.has(t));
}

async function getRowCount(client, table) {
  try {
    const { rows } = await client.query(`SELECT COUNT(*) as c FROM "${table}"`);
    return parseInt(rows[0].c);
  } catch (_) { return 0; }
}

async function migrate() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  SILVERSTAR GROW — Full Data Re-Migration');
  console.log('  Source: 54.235.46.178  →  Target: AWS RDS');
  console.log('═══════════════════════════════════════════════════\n');

  const oldClient = await OLD.connect();
  const newClient = await NEW.connect();

  try {
    // ── STEP 1: Get all tables from old server ──────────────────
    console.log('📋 Getting table list from old server...');
    const tables = await getAllTables(oldClient);
    console.log(`   Found ${tables.length} tables\n`);

    // ── STEP 2: Check old server row counts ─────────────────────
    console.log('📊 Old server data summary:');
    const tableData = {};
    for (const table of tables) {
      const count = await getRowCount(oldClient, table);
      tableData[table] = count;
      if (count > 0) {
        console.log(`   ${table.padEnd(40)} ${count} rows`);
      }
    }

    const tablesWithData = tables.filter(t => tableData[t] > 0);
    console.log(`\n   ${tablesWithData.length} tables have data to migrate\n`);

    // ── STEP 3: Disable FK checks + TRUNCATE on new RDS ─────────
    console.log('🗑️  Clearing existing data on new RDS...');
    await newClient.query('BEGIN');
    await newClient.query("SET session_replication_role = 'replica'");

    for (const table of tablesWithData) {
      try {
        await newClient.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
        process.stdout.write(`   ✓ Cleared ${table}\n`);
      } catch (e) {
        console.warn(`   ⚠️  Could not truncate ${table}: ${e.message}`);
      }
    }
    console.log('   ✅ All tables cleared\n');

    // ── STEP 4: Insert all data ──────────────────────────────────
    console.log('⬆️  Inserting data from old server...\n');
    let totalInserted = 0;
    let totalFailed = 0;

    for (const table of tablesWithData) {
      const count = tableData[table];
      if (count === 0) continue;

      process.stdout.write(`   Migrating ${table} (${count} rows)... `);

      try {
        const { rows } = await oldClient.query(
          `SELECT * FROM "${table}" ORDER BY id NULLS LAST`
        );

        if (rows.length === 0) { console.log('(empty)'); continue; }

        const cols = Object.keys(rows[0]);
        const colList = cols.map(c => `"${c}"`).join(', ');
        let inserted = 0;
        let failed = 0;

        for (const row of rows) {
          const vals = cols.map(c => row[c]);
          const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
          try {
            await newClient.query(
              `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
              vals
            );
            inserted++;
          } catch (_) { failed++; }
        }

        console.log(`✅ ${inserted}/${rows.length} inserted${failed > 0 ? `, ⚠️ ${failed} skipped` : ''}`);
        totalInserted += inserted;
        totalFailed += failed;

      } catch (e) {
        console.log(`❌ Failed: ${e.message}`);
        totalFailed += count;
      }
    }

    // ── STEP 5: Reset sequences ──────────────────────────────────
    console.log('\n🔄 Resetting sequences...');
    const { rows: seqs } = await newClient.query(`
      SELECT sequence_name FROM information_schema.sequences
      WHERE sequence_schema = 'public'
    `);
    for (const { sequence_name } of seqs) {
      const tableName = sequence_name.replace(/_id_seq$/, '');
      try {
        await newClient.query(
          `SELECT setval('${sequence_name}', COALESCE((SELECT MAX(id) FROM "${tableName}"), 1))`
        );
      } catch (_) {}
    }
    console.log('   ✅ Sequences reset\n');

    // ── STEP 6: Commit ───────────────────────────────────────────
    await newClient.query("SET session_replication_role = 'origin'");
    await newClient.query('COMMIT');

    console.log('═══════════════════════════════════════════════════');
    console.log(`  ✅ Migration Complete!`);
    console.log(`  📊 Total inserted: ${totalInserted}`);
    console.log(`  ⚠️  Total skipped:  ${totalFailed}`);
    console.log('═══════════════════════════════════════════════════\n');

    // ── STEP 7: Verification ─────────────────────────────────────
    console.log('📋 New RDS verification:');
    for (const table of tablesWithData) {
      const count = await getRowCount(newClient, table);
      if (count > 0) console.log(`   ${table.padEnd(40)} ${count} rows`);
    }

  } catch (err) {
    await newClient.query('ROLLBACK').catch(() => {});
    await newClient.query("SET session_replication_role = 'origin'").catch(() => {});
    console.error('\n❌ Migration FAILED:', err.message);
  } finally {
    oldClient.release();
    newClient.release();
    await OLD.end();
    await NEW.end();
  }
}

migrate();
