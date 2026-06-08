const { Pool } = require('pg');
require('dotenv').config();
const fs = require('fs');

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

pool.query('SELECT id, doc_number FROM purchase_notes WHERE id = 170')
  .then(res => {
    fs.writeFileSync('db_test_result.json', JSON.stringify(res.rows, null, 2));
    process.exit(0);
  })
  .catch(err => {
    fs.writeFileSync('db_test_result.json', JSON.stringify({error: err.message}));
    process.exit(1);
  });
