const { Client } = require('pg');
const fs = require('fs');

async function listDbs() {
  const client = new Client({
    host: '54.235.46.178',
    port: 5432,
    database: 'postgres',
    user: 'ssg',
    password: 'Nidhi',
    connectionTimeoutMillis: 5000
  });

  try {
    await client.connect();
    const res = await client.query('SELECT datname FROM pg_database WHERE datistemplate = false;');
    fs.writeFileSync('dbs.json', JSON.stringify({ success: true, dbs: res.rows.map(r => r.datname) }));
  } catch (err) {
    fs.writeFileSync('dbs.json', JSON.stringify({ success: false, error: err.message }));
  } finally {
    await client.end();
  }
}
listDbs();
