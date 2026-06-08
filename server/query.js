require('dotenv').config();
const { Pool } = require('pg');
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
    fs.writeFileSync('test_output.json', JSON.stringify(res.rows));
    process.exit(0);
  })
  .catch(err => {
    fs.writeFileSync('test_output.json', JSON.stringify({error: err.message}));
    process.exit(1);
  });
