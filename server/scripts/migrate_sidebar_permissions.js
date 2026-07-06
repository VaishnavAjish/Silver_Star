require('dotenv').config();
const pool = require('../db/pool');

async function migrateSidebarPermissions() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log('Running sidebar permissions migration...');
    
    // Grant sidebar permission (1024) to any role that currently has view permission (1)
    const query = `
      UPDATE role_permissions 
      SET permissions = permissions | 1024 
      WHERE (permissions & 1) = 1;
    `;
    
    const result = await client.query(query);
    console.log(`Successfully migrated ${result.rowCount} role permissions.`);
    
    await client.query('COMMIT');
    console.log('Migration completed successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
  } finally {
    client.release();
    process.exit(0);
  }
}

migrateSidebarPermissions();
