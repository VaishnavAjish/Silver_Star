require('dotenv').config();
const pool = require('./db/pool');

async function run() {
  // Find ALL FK constraints pointing to any _old table
  const { rows: brokenFKs } = await pool.primaryPool.query(`
    SELECT
      tc.table_name AS source_table,
      kcu.column_name AS source_column,
      ccu.table_name AS target_table,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_name LIKE '%_old'
    ORDER BY tc.table_name
  `);

  console.log('=== BROKEN FKs pointing to _old tables ===');
  if (brokenFKs.length === 0) {
    console.log('NONE FOUND - All clean!');
  } else {
    brokenFKs.forEach(r =>
      console.log(`❌ ${r.source_table}.${r.source_column} -> ${r.target_table} [${r.constraint_name}]`)
    );
  }

  // Also check for any FK that references a table that doesn't exist
  const { rows: allFKs } = await pool.primaryPool.query(`
    SELECT
      tc.table_name AS source_table,
      kcu.column_name AS source_column,
      ccu.table_name AS target_table,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name
  `);

  // Get all tables that actually exist
  const { rows: tables } = await pool.primaryPool.query(`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `);
  const existingTables = new Set(tables.map(t => t.tablename));

  const missingTarget = allFKs.filter(r => !existingTables.has(r.target_table));
  console.log('\n=== FKs referencing NON-EXISTENT tables ===');
  if (missingTarget.length === 0) {
    console.log('NONE FOUND - All clean!');
  } else {
    missingTarget.forEach(r =>
      console.log(`❌ ${r.source_table}.${r.source_column} -> ${r.target_table} (MISSING!) [${r.constraint_name}]`)
    );
  }

  console.log('\n=== Summary ===');
  console.log(`Total FKs: ${allFKs.length}`);
  console.log(`Broken (pointing to _old): ${brokenFKs.length}`);
  console.log(`Broken (target missing): ${missingTarget.length}`);
  
  process.exit();
}
run();
