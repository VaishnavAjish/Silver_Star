require('dotenv').config();
const pool = require('../db/pool');

async function run() {
  try {
    console.log('Adding trigger to protect audit_logs...');
    await pool.query(`
      CREATE OR REPLACE FUNCTION prevent_audit_deletion()
      RETURNS TRIGGER AS $$
      BEGIN
          RAISE EXCEPTION 'Deletion of audit logs is strictly prohibited.';
          RETURN NULL;
      END;
      $$ LANGUAGE plpgsql;
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS trg_prevent_audit_delete ON audit_logs;
    `);

    await pool.query(`
      CREATE TRIGGER trg_prevent_audit_delete
      BEFORE DELETE OR TRUNCATE ON audit_logs
      FOR EACH STATEMENT
      EXECUTE FUNCTION prevent_audit_deletion();
    `);

    console.log('Trigger added successfully.');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit();
  }
}

run();
