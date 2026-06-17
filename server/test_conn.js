const { Client } = require('pg');

const client = new Client({
  host: '54.235.46.178',
  port: 5432,
  database: 'silverstar_grow',
  user: 'postgres',
  password: 'nidhi',
  connectionTimeoutMillis: 3000
});

client.connect()
  .then(() => {
    console.log('SUCCESS');
    client.end();
  })
  .catch(err => {
    console.error('ERROR: ' + err.message);
  });
