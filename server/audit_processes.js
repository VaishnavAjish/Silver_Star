#!/usr/bin/env node
/**
 * PROCESS MASTER — PRODUCTION REFERENCE AUDIT
 * ============================================
 * READ-ONLY. No mutations.
 * Uses BEGIN TRANSACTION READ ONLY + ROLLBACK.
 *
 * Run on EC2:  node audit_processes.js > audit_results.txt 2>&1
 */
require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 15000,
  statement_timeout: 60000,
});

function fmt(rows) { return JSON.stringify(rows, null, 2); }

async function run() {
  await client.connect();
  console.log('=== CONNECTED ===');
  await client.query('BEGIN TRANSACTION READ ONLY');

  // ── SAFETY GATE ──────────────────────────────────────────────
  console.log('\n========== SAFETY GATE ==========');
  const env = (await client.query(`
    SELECT current_database() AS database_name,
           current_user       AS database_user,
           version()          AS postgres_version,
           now()              AS audited_at
  `)).rows[0];
  console.log(fmt(env));

  // ── PHASE 1 — SCHEMA VERIFICATION ───────────────────────────
  console.log('\n========== PHASE 1 — SCHEMA VERIFICATION ==========');

  const tables = [
    'process_master', 'lot_process_issues', 'machine_processes',
    'lot_process_returns', 'lot_process_return_lines', 'inventory',
    'inventory_history', 'rough_growth', 'growth_run_cycles',
    'inventory_operations'
  ];

  for (const tbl of tables) {
    const cols = (await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [tbl])).rows;

    if (cols.length > 0) {
      console.log(`\n--- TABLE: ${tbl} (${cols.length} columns) ---`);
      const relevant = cols.filter(c =>
        /process|type|code|group|category|status|issue|return|machine|active/i.test(c.column_name)
      );
      console.log('Process/status columns:');
      for (const c of relevant) {
        console.log(`  ${c.column_name} :: ${c.data_type} (nullable=${c.is_nullable}, default=${c.column_default || 'none'})`);
      }
      console.log('ALL columns:');
      for (const c of cols) {
        console.log(`  ${c.column_name} :: ${c.data_type}`);
      }
    } else {
      console.log(`\n--- TABLE: ${tbl} — DOES NOT EXIST ---`);
    }
  }

  // Foreign keys to/from process_master
  console.log('\n--- FOREIGN KEYS referencing process_master ---');
  const fks = (await client.query(`
    SELECT
      tc.table_name   AS from_table,
      kcu.column_name AS from_column,
      ccu.table_name  AS to_table,
      ccu.column_name AS to_column,
      tc.constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND (ccu.table_name = 'process_master' OR tc.table_name = 'process_master')
    ORDER BY tc.table_name
  `)).rows;
  if (fks.length > 0) {
    for (const fk of fks) {
      console.log(`  ${fk.from_table}.${fk.from_column} → ${fk.to_table}.${fk.to_column}  (${fk.constraint_name})`);
    }
  } else {
    console.log('  (none — relations use process_code strings, not FK IDs)');
  }

  // Primary keys
  console.log('\n--- PRIMARY KEYS ---');
  for (const tbl of tables) {
    const pk = (await client.query(`
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
      WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1
    `, [tbl])).rows;
    if (pk.length > 0) console.log(`  ${tbl}: ${pk.map(r => r.column_name).join(', ')}`);
  }

  // ── PHASE 2 — PROCESS MASTER MATRIX ─────────────────────────
  console.log('\n========== PHASE 2 — PROCESS MASTER MATRIX ==========');
  const pm = (await client.query(`
    SELECT id, process_code, process_name, active, category,
           process_group, eligible_machine_type, input_item_category,
           output_type, allowed_outputs,
           requires_inventory, requires_machine, requires_operator,
           requires_runtime, requires_expected_yield, allows_consumables,
           completion_mode, default_runtime_hours, sort_order
    FROM process_master
    ORDER BY process_code
  `)).rows;
  console.log(`Total process_master rows: ${pm.length}`);
  console.log(fmt(pm));

  // ── PHASE 3 — REFERENCE COUNTS ──────────────────────────────
  console.log('\n========== PHASE 3 — REFERENCE COUNTS ==========');

  // Verify column names first
  const lpiCols = (await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'lot_process_issues'
      AND column_name IN ('process_type','process_code','process_master_id')
  `)).rows;
  console.log(`lot_process_issues process column(s): ${lpiCols.map(r => r.column_name).join(', ')}`);

  const mpCols = (await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'machine_processes'
      AND column_name IN ('process_type','process_code','process_master_id')
  `)).rows;
  console.log(`machine_processes process column(s): ${mpCols.map(r => r.column_name).join(', ')}`);

  // Check machine_processes status values
  const mpStatuses = (await client.query(`
    SELECT DISTINCT status FROM machine_processes ORDER BY status
  `)).rows;
  console.log(`machine_processes distinct statuses: ${mpStatuses.map(r => r.status).join(', ')}`);

  // Reference counts
  const refs = (await client.query(`
    SELECT
      pm.id,
      pm.process_code,
      pm.process_name,
      pm.active,
      pm.process_group,
      (SELECT COUNT(*) FROM lot_process_issues lpi
        WHERE lpi.process_type = pm.process_code AND lpi.status = 'OPEN') AS open_issues,
      (SELECT COUNT(*) FROM lot_process_issues lpi
        WHERE lpi.process_type = pm.process_code AND lpi.status != 'OPEN') AS historical_issues,
      (SELECT COUNT(*) FROM lot_process_issues lpi
        WHERE lpi.process_type = pm.process_code) AS total_issues,
      (SELECT COUNT(*) FROM machine_processes mp
        WHERE mp.process_type = pm.process_code) AS total_machine_processes,
      (SELECT COUNT(*) FROM machine_processes mp
        WHERE mp.process_type = pm.process_code
          AND mp.status NOT IN ('completed','cancelled','stopped','removed','deleted'))
        AS active_machine_processes,
      (SELECT COUNT(*)
        FROM lot_process_returns lpr
        JOIN lot_process_issues lpi ON lpr.issue_id = lpi.id
        WHERE lpi.process_type = pm.process_code) AS return_count
    FROM process_master pm
    ORDER BY pm.process_code
  `)).rows;
  console.log(fmt(refs));

  // inventory_history references
  console.log('\n--- inventory_history process references ---');
  const ihCols = (await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'inventory_history'
      AND column_name IN ('process_type','process_code','source_type','event_type')
  `)).rows;
  console.log(`inventory_history relevant columns: ${ihCols.map(r => r.column_name).join(', ')}`);

  if (ihCols.some(c => c.column_name === 'process_type')) {
    const ihRefs = (await client.query(`
      SELECT process_type, COUNT(*) AS cnt
      FROM inventory_history
      WHERE process_type IS NOT NULL
      GROUP BY process_type
      ORDER BY process_type
    `)).rows;
    console.log('inventory_history by process_type:');
    console.log(fmt(ihRefs));
  }

  if (ihCols.some(c => c.column_name === 'source_type')) {
    const ihSrc = (await client.query(`
      SELECT source_type, COUNT(*) AS cnt
      FROM inventory_history
      WHERE source_type IS NOT NULL
      GROUP BY source_type
      ORDER BY source_type
    `)).rows;
    console.log('inventory_history by source_type:');
    console.log(fmt(ihSrc));
  }

  // rough_growth references
  console.log('\n--- rough_growth process references ---');
  const rgCols = (await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'rough_growth'
      AND column_name IN ('process_type','process_code')
  `)).rows;
  if (rgCols.length > 0) {
    const colName = rgCols[0].column_name;
    const rgRefs = (await client.query(`
      SELECT ${colName}, COUNT(*) AS cnt
      FROM rough_growth
      WHERE ${colName} IS NOT NULL
      GROUP BY ${colName}
      ORDER BY ${colName}
    `)).rows;
    console.log(`rough_growth by ${colName}:`);
    console.log(fmt(rgRefs));
  } else {
    console.log('(no process_type/process_code column in rough_growth)');
  }

  // growth_run_cycles
  console.log('\n--- growth_run_cycles ---');
  const grcCols = (await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'growth_run_cycles'
      AND column_name IN ('process_type','process_code')
  `)).rows;
  if (grcCols.length > 0) {
    console.log(`growth_run_cycles process columns: ${grcCols.map(r => r.column_name).join(', ')}`);
  } else {
    console.log('(table does not exist or has no process column)');
  }

  // ── PHASE 4 — OPEN TRANSACTION DETAILS ──────────────────────
  console.log('\n========== PHASE 4 — OPEN TRANSACTION DETAILS ==========');

  // All open issues with legacy process codes
  const legacyCodes = ['pr-01','pr-02','pr-03','pr-04','pr-05','pr-06','growth_cut','cutting'];
  const openLegacy = (await client.query(`
    SELECT
      lpi.id            AS issue_id,
      lpi.issue_number,
      lpi.process_type,
      lpi.status,
      lpi.created_at,
      lpi.process_lot_id,
      inv.lot_code      AS process_lot_code,
      lpi.machine_process_id,
      lpi.issued_qty,
      lpi.remaining_in_process,
      mp.machine_id,
      m.machine_name,
      m.machine_code,
      mp.process_number,
      mp.status         AS mp_status
    FROM lot_process_issues lpi
    LEFT JOIN inventory inv ON inv.id = lpi.process_lot_id
    LEFT JOIN machine_processes mp ON mp.id = lpi.machine_process_id
    LEFT JOIN machines m ON m.id = mp.machine_id
    WHERE lpi.status = 'OPEN'
    ORDER BY lpi.process_type, lpi.created_at
  `)).rows;
  console.log(`Total OPEN issues (all processes): ${openLegacy.length}`);
  console.log(fmt(openLegacy));

  // Active machine processes for legacy codes
  const activeMpLegacy = (await client.query(`
    SELECT mp.id, mp.process_type, mp.status, mp.machine_id,
           m.machine_name, m.machine_code,
           mp.started_at, mp.completed_at
    FROM machine_processes mp
    LEFT JOIN machines m ON m.id = mp.machine_id
    WHERE mp.process_type IN ('pr-01','pr-02','pr-03','pr-04','pr-05','pr-06','growth_cut','cutting')
      AND mp.status NOT IN ('completed','cancelled','stopped','removed','deleted')
    ORDER BY mp.process_type, mp.started_at
  `)).rows;
  console.log(`\nActive machine processes with legacy codes: ${activeMpLegacy.length}`);
  console.log(fmt(activeMpLegacy));

  // ── PHASE 5 — DUPLICATE COMPARISON ──────────────────────────
  console.log('\n========== PHASE 5 — DUPLICATE COMPARISON ==========');
  const pairs = [
    ['pr-01', 'growth'],
    ['pr-02', 'edge_cut'],
    ['pr-03', 'block_cut'],
    ['pr-04', 'outer_cut'],
    ['pr-05', 'seed_remove'],
  ];
  for (const [legacy, canonical] of pairs) {
    const pair = (await client.query(`
      SELECT id, process_code, process_name, active, category,
             process_group, eligible_machine_type, input_item_category,
             output_type, allowed_outputs,
             requires_inventory, requires_machine, requires_operator,
             requires_runtime, requires_expected_yield, allows_consumables,
             completion_mode, default_runtime_hours, sort_order
      FROM process_master
      WHERE process_code IN ($1, $2)
      ORDER BY process_code
    `, [legacy, canonical])).rows;
    console.log(`\n--- PAIR: ${legacy} vs ${canonical} ---`);
    console.log(fmt(pair));
  }

  // Extras
  const extras = (await client.query(`
    SELECT id, process_code, process_name, active, category,
           process_group, eligible_machine_type, input_item_category,
           output_type, allowed_outputs,
           requires_inventory, requires_machine, requires_operator,
           requires_runtime, requires_expected_yield, allows_consumables,
           completion_mode, default_runtime_hours, sort_order
    FROM process_master
    WHERE process_code IN ('pr-06', 'growth_cut', 'cutting', 'final_block')
    ORDER BY process_code
  `)).rows;
  console.log('\n--- EXTRAS: pr-06, growth_cut, cutting, final_block ---');
  console.log(fmt(extras));

  // ── PHASE 6 — FINAL BLOCK DECISION ─────────────────────────
  console.log('\n========== PHASE 6 — FINAL BLOCK ==========');
  const fbExists = (await client.query(`
    SELECT process_code FROM process_master WHERE process_code = 'final_block'
  `)).rows;
  console.log(`final_block code already exists: ${fbExists.length > 0}`);

  const fbBlockCut = (await client.query(`
    SELECT id, process_code, process_name, process_group, eligible_machine_type, output_type, allowed_outputs
    FROM process_master
    WHERE process_code IN ('pr-06', 'block_cut', 'growth_cut', 'final_block')
    ORDER BY process_code
  `)).rows;
  console.log('Final Block related records:');
  console.log(fmt(fbBlockCut));

  // ── PHASE 7 — SEED REMOVE SAFETY ──────────────────────────
  console.log('\n========== PHASE 7 — SEED REMOVE ==========');
  const srPair = (await client.query(`
    SELECT id, process_code, process_name, active, allowed_outputs,
           completion_mode, process_group, eligible_machine_type, input_item_category
    FROM process_master
    WHERE process_code IN ('pr-05', 'seed_remove')
    ORDER BY process_code
  `)).rows;
  console.log('Seed Remove config comparison:');
  console.log(fmt(srPair));

  const srIssues = (await client.query(`
    SELECT process_type, status, COUNT(*) AS cnt
    FROM lot_process_issues
    WHERE process_type IN ('pr-05', 'seed_remove')
    GROUP BY process_type, status
    ORDER BY process_type, status
  `)).rows;
  console.log('\nSeed Remove issue breakdown:');
  console.log(fmt(srIssues));

  const srReturns = (await client.query(`
    SELECT lpi.process_type, COUNT(*) AS return_cnt
    FROM lot_process_returns lpr
    JOIN lot_process_issues lpi ON lpr.issue_id = lpi.id
    WHERE lpi.process_type IN ('pr-05', 'seed_remove')
    GROUP BY lpi.process_type
  `)).rows;
  console.log('\nSeed Remove returns:');
  console.log(fmt(srReturns));

  // ── PHASE 8 — ROLLBACK ─────────────────────────────────────
  await client.query('ROLLBACK');
  console.log('\n========== PHASE 8 — TRANSACTION ROLLED BACK ==========');
  console.log('Read-only transaction rolled back.');
  console.log('Data modified: NO');
  console.log('Migrations applied: NO');
  console.log('Services restarted: NO');
  console.log('\n=== AUDIT COMPLETE ===');
}

run().catch(err => {
  console.error('FATAL:', err.message);
  client.query('ROLLBACK').catch(() => {});
}).finally(() => {
  client.end();
});
