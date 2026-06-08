require('dotenv').config();
const pool = require('./db/pool');

async function fix() {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query('ALTER TABLE purchase_note_lines DROP CONSTRAINT IF EXISTS purchase_note_lines_purchase_note_id_fkey;');
    // Intentionally not adding it back because purchase_notes is partitioned and cannot be referenced by just id
    await client.query('COMMIT');
    console.log('Successfully fixed FK constraint');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error fixing FK:', err.message);
  } finally {
    client.release();
    process.exit();
  }
}
fix();
