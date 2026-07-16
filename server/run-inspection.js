const fs = require('fs');
require('dotenv').config();
const pool = require('./db/pool').primaryPool;

async function run() {
  const sql = fs.readFileSync(__dirname + '/sql/ssd086-inspection.sql', 'utf8');
  try {
    const client = await pool.connect();
    // Use multi-result query (postgres can return an array of results for multiple statements)
    const res = await client.query(sql);
    client.release();
    
    // Postgres returns an array of result objects when running multiple statements
    if (Array.isArray(res)) {
      res.forEach(r => {
        if (r.command === 'SELECT' && r.rows.length > 0) {
          console.log('\n---', r.rows[0].section, '---');
          console.table(r.rows);
        }
      });
    }
  } catch (err) {
    console.error('ERROR:', err);
  }
  process.exit(0);
}
run();
