require('dotenv').config();
const pool = require('./db/pool');

async function fix() {
  try {
    await pool.query(`INSERT INTO code_sequences (entity_type, prefix, separator, next_value, padding, format_pattern, active) VALUES ('fixed_asset', 'FA', '-', 1, 4, 'PREFIX-SEQ', true) ON CONFLICT (entity_type) DO NOTHING;`);
    console.log('Fixed Asset Sequence Inserted!');
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
fix();
