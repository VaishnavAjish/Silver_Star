require('dotenv').config();
const pool = require('./db/pool');

async function fix() {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    
    // Check current indexes on user_clipboard
    const { rows: indexes } = await client.query(
      'SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1',
      ['user_clipboard']
    );
    console.log('Current indexes:');
    indexes.forEach(r => console.log(' -', r.indexname, '|', r.indexdef));

    // Check current constraints
    const { rows: constraints } = await client.query(`
      SELECT constraint_name, constraint_type 
      FROM information_schema.table_constraints 
      WHERE table_name = 'user_clipboard' AND table_schema = 'public'
    `);
    console.log('Current constraints:');
    constraints.forEach(r => console.log(' -', r.constraint_name, ':', r.constraint_type));

    // Add the missing unique constraint so ON CONFLICT works
    await client.query(`
      ALTER TABLE user_clipboard 
      ADD CONSTRAINT user_clipboard_unique 
      UNIQUE (user_id, entity_type, entity_id)
    `);
    console.log('\n✅ Added UNIQUE constraint on (user_id, entity_type, entity_id)');

    await client.query('COMMIT');
    console.log('Done!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error:', err.message);
  } finally {
    client.release();
    process.exit();
  }
}
fix();
