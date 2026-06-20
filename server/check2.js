const { Pool } = require('pg');

const p = new Pool({
  host: '192.168.1.211',
  port: 5433,
  database: 'silverstar_grow',
  user: 'postgres',
  password: 'Nidhi',
  ssl: false,
});

async function run() {
  const r = await p.query(`SELECT code, name FROM accounts ORDER BY code LIMIT 50`);
  console.log(`Found ${r.rows.length} accounts:`);
  console.table(r.rows);
  await p.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
