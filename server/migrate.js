require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db/pool');

async function migrate() {
  const client = await pool.primaryPool.connect();
  try {
    // 1. Ensure migrations_history table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations_history (
        id SERIAL PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Read all .sql files in migrations directory
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort(); // Sort alphabetically

    console.log(`Found ${files.length} migration files.`);

    // 3. Apply unapplied migrations
    let appliedCount = 0;
    for (const file of files) {
      const { rows } = await client.query('SELECT id FROM migrations_history WHERE filename = $1', [file]);
      if (rows.length > 0) {
        console.log(`Skipping ${file} (already applied)`);
        continue;
      }

      console.log(`\n--- Applying ${file} ---`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      
      try {
        const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
        for (const stmt of statements) {
          await client.query(stmt);
        }
        await client.query('INSERT INTO migrations_history (filename) VALUES ($1)', [file]);
        console.log(`✅ Successfully applied ${file}`);
        appliedCount++;
      } catch (err) {
        console.error(`❌ Error applying ${file}:`, err.message);
        throw err; // Stop on first error
      }
    }

    console.log(`\nMigration complete. Applied ${appliedCount} new migrations.`);
  } catch (err) {
    console.error('\nMigration failed:', err.message);
  } finally {
    client.release();
    process.exit();
  }
}

migrate();
