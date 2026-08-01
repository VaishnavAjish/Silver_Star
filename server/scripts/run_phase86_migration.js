'use strict';

const fs = require('fs');
const path = require('path');

// Load environment variables safely
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const pool = require('../db/pool');

async function runPhase86Migration() {
  console.log('=== RUNNING MIGRATION: phase86-user-permission-overrides.sql ===');
  const migrationPath = path.join(__dirname, '../migrations/phase86-user-permission-overrides.sql');

  if (!fs.existsSync(migrationPath)) {
    console.error(`ERROR: Migration file not found at ${migrationPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(migrationPath, 'utf8');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    console.log('Executing phase86-user-permission-overrides.sql in transaction...');
    await client.query(sql);

    // Verify table creation
    const { rows: [t] } = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_name = 'user_permission_overrides'
    `);

    if (!t) {
      throw new Error('Table user_permission_overrides was not created properly.');
    }

    // Verify constraint
    const { rows: [c] } = await client.query(`
      SELECT constraint_name FROM information_schema.table_constraints 
      WHERE table_name = 'user_permission_overrides' AND constraint_name = 'chk_masks_no_overlap'
    `);

    if (!c) {
      throw new Error('Constraint chk_masks_no_overlap was not created properly.');
    }

    await client.query('COMMIT');
    console.log('✔ Phase 86 Migration executed successfully and committed to database!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✘ MIGRATION FAILED - TRANSACTION ROLLED BACK:', err.message);
    process.exit(1);
  } finally {
    client.release();
    process.exit(0);
  }
}

runPhase86Migration();
