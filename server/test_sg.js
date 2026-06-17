const { Client } = require('pg');
const fs = require('fs');

async function test() {
  const client = new Client({
    host: '54.235.46.178',
    port: 5432,
    database: 'silverstar_grow',
    user: 'ssg',
    password: 'Nidhi',
    connectionTimeoutMillis: 5000
  });

  try {
    await client.connect();
    const res = await client.query('SELECT tablename FROM pg_tables WHERE schemaname = \'public\'');
    fs.writeFileSync('db_test_result.txt', 'SUCCESS. Tables: ' + res.rows.map(r => r.tablename).join(', '));
    await client.end();
  } catch (err) {
    fs.writeFileSync('db_test_result.txt', 'ERROR: ' + err.message);
  }
}
test();
