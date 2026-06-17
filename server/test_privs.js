const { Client } = require('pg');

async function testPrivileges() {
  const client = new Client({
    host: '54.235.46.178',
    port: 5432,
    database: 'postgres',
    user: 'ssg',
    password: 'Nidhi'
  });

  try {
    await client.connect();
    await client.query('CREATE TABLE _test_privs (id INT)');
    await client.query('DROP TABLE _test_privs');
    console.log('Privilege check SUCCESS: ssg can create tables in public.');
  } catch (err) {
    console.error('Privilege check FAILED: ' + err.message);
  } finally {
    await client.end();
  }
}
testPrivileges();
