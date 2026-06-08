require('dotenv').config();
const fs = require('fs');
const pool = require('./db/pool');

async function runMigration() {
  const client = await pool.primaryPool.connect();
  try {
    const sql = fs.readFileSync('./migrations/phase32_growth_run.sql', 'utf8');
    
    // We have to split the script because ALTER TYPE must run outside a transaction,
    // and the rest runs inside a BEGIN; ... COMMIT; block.
    // The script already has BEGIN; and COMMIT;, but node-postgres sometimes
    // has issues running multiple statements with mixed transaction states in a single query() call.
    // However, typical pg clients can run it if we send it as one block. Let's try.
    
    // Actually, ALTER TYPE ... ADD VALUE cannot be executed inside a transaction block.
    // So let's extract the ALTER TYPE command and run it first.
    const alterTypeSql = "ALTER TYPE item_category ADD VALUE IF NOT EXISTS 'growth_run';";
    
    console.log("Running ALTER TYPE...");
    try {
      await client.query(alterTypeSql);
    } catch (e) {
      if (e.code === '42710') {
        // 42710 is duplicate_object. Ignore if it already exists.
        console.log("Enum value already exists.");
      } else {
        throw e;
      }
    }

    // Now run the rest of the script (excluding the ALTER TYPE)
    console.log("Running the rest of the migration...");
    const restOfSql = sql.replace(/ALTER TYPE item_category ADD VALUE IF NOT EXISTS 'growth_run';/g, '');
    
    await client.query(restOfSql);
    console.log("Migration 32 applied successfully!");

  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    client.release();
    process.exit(0);
  }
}

runMigration();
