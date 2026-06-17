const { Client } = require('pg');

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
    console.log("DATABASES: " + res.rows.map(r => r.datname).join(', '));
  } catch (err) {
    console.error("ERROR: " + err.message);
  } finally {
    await client.end();
  }
}
listDbs();
