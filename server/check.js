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
  const codes = ['1001','1002','1003','1004','1050','2001','2002','2003','2004','2005','2050','3001','3002','4001','4099','5001','5002','5003','5004','5010'];
  const placeholders = codes.map((_, i) => `$${i+1}`).join(',');
  const r = await p.query(`SELECT code, name FROM accounts WHERE code IN (${placeholders}) ORDER BY code`, codes);
  console.table(r.rows);
  await p.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
