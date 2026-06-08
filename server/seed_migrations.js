require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db/pool');

async function seedHistory() {
  const client = await pool.primaryPool.connect();
  try {
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
    
    for (const file of files) {
      await client.query(
        'INSERT INTO migrations_history (filename) VALUES ($1) ON CONFLICT DO NOTHING',
        [file]
      );
    }
    console.log(`Seeded ${files.length} migration records as already applied.`);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    process.exit();
  }
}

seedHistory();
