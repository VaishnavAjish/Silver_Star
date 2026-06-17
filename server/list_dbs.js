const { Client } = require('pg');
const fs = require('fs');

async function checkDatabases() {
  const client = new Client({
    host: '54.235.46.178',
    port: 5432,
    database: 'postgres',
    user: 'ssg',
    password: 'Nidhi',
    ssl: false,
    connectionTimeoutMillis: 3000
  });

  try {
    await client.connect();
    const res = await client.query('SELECT datname FROM pg_database WHERE datistemplate = false;');
    const dbs = res.rows.map(r => r.datname);
    fs.writeFileSync('db_list.txt', dbs.join('\n'));
    await client.end();
    console.log('Databases listed successfully.');
    process.exit(0);
  } catch (err) {
    fs.writeFileSync('db_list.txt', 'ERROR: ' + err.message);
    process.exit(1);
  }
}

checkDatabases();
