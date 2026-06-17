const { Client } = require('pg');
const fs = require('fs');

const log = (msg) => fs.appendFileSync('results.txt', msg + '\n');

async function testConn(password, ssl) {
  const client = new Client({
    host: '54.235.46.178',
    port: 5432,
    database: 'silverstar_grow',
    user: 'postgres',
    password: password,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    connectionTimeoutMillis: 3000
  });

  try {
    await client.connect();
    log(`SUCCESS! Password: ${password}, SSL: ${ssl}`);
    await client.end();
    return true;
  } catch (err) {
    log(`FAILED. Password: ${password}, SSL: ${ssl} -> ${err.message}`);
    return false;
  }
}

async function runTests() {
  fs.writeFileSync('results.txt', ''); // clear
  const configs = [
    { pass: 'nidhi', ssl: false },
    { pass: 'Nidhi', ssl: false },
    { pass: 'nidhi', ssl: true },
    { pass: 'Nidhi', ssl: true }
  ];

  let success = false;
  for (const c of configs) {
    if (await testConn(c.pass, c.ssl)) {
      success = true;
      break;
    }
  }
  process.exit(success ? 0 : 1);
}

runTests();
