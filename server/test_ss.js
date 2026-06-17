const { Client } = require('pg');
const fs = require('fs');

async function testSS() {
  const client = new Client({
    host: '54.235.46.178',
    port: 5432,
    database: 'ss',
    user: 'ssg',
    password: 'Nidhi',
    connectionTimeoutMillis: 5000
  });

  try {
    await client.connect();
    const res = await client.query('SELECT count(*) FROM users');
    fs.writeFileSync('db_test_ss.txt', 'SUCCESS. User count: ' + res.rows[0].count);
    await client.end();
  } catch (err) {
    fs.writeFileSync('db_test_ss.txt', 'ERROR: ' + err.message);
  }
}
testSS();
