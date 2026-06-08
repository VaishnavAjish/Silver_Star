require('dotenv').config();
const pool = require('./db/pool');

async function run() {
  try {
    // Test the actual clipboard insert query
    const { rows } = await pool.primaryPool.query(
      `INSERT INTO user_clipboard (user_id, entity_type, entity_id, label)
       SELECT $1, $2, $3, $4
       WHERE EXISTS (
         SELECT 1 FROM user_clipboard
         WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3
       ) OR (SELECT COUNT(*) FROM user_clipboard WHERE user_id = $1) < $5
       ON CONFLICT (user_id, entity_type, entity_id)
       DO UPDATE SET label = EXCLUDED.label, added_at = now()
       RETURNING id, entity_type, entity_id, label, added_at`,
      [1, 'inventory', '123', 'Test Lot', 100]
    );
    console.log('POST query works. Result:', rows);

    // Clean up
    await pool.primaryPool.query(`DELETE FROM user_clipboard WHERE entity_id = '123' AND user_id = 1`);
    console.log('Cleanup done.');
  } catch (err) {
    console.error('Error:', err.message);
  }
  process.exit();
}
run();
