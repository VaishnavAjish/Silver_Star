require('dotenv').config();
const fs = require('fs');
const pool = require('./db/pool');
const path = require('path');

async function checkMigrations() {
  const client = await pool.primaryPool.connect();
  try {
    const files = [
      'phase35-rbac.sql',
      'phase36-submodule-permissions.sql',
      'phase37-source-module.sql',
      'phase38-super-admin-role.sql'
    ];

    console.log("Checking if specific schema changes from migrations exist...\n");

    // Check Phase 35
    const { rows: rbac } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'roles'
      ) as exists;
    `);
    console.log(`Phase 35 (roles table exists): ${rbac[0].exists}`);

    // Check Phase 36
    const { rows: p36 } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'role_permissions' AND column_name = 'submodule'
      ) as exists;
    `);
    console.log(`Phase 36 (role_permissions.submodule exists): ${p36[0].exists}`);

    // Check Phase 37
    const { rows: p37 } = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'inventory' AND column_name = 'source_module'
      ) as exists;
    `);
    console.log(`Phase 37 (inventory.source_module exists): ${p37[0].exists}`);

    // Check Phase 38
    const { rows: p38 } = await client.query(`
      SELECT EXISTS (
        SELECT FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE r.slug = 'super_admin'
      ) as exists;
    `);
    console.log(`Phase 38 (super_admin role assigned): ${p38[0].exists}`);

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    process.exit();
  }
}
checkMigrations();
