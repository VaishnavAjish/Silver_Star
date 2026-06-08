require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});
pool.query('SELECT id, doc_number FROM purchase_notes ORDER BY id DESC LIMIT 5')
  .then(res => {
    require('fs').writeFileSync('db_output.txt', JSON.stringify(res.rows, null, 2));
    process.exit(0);
  })
  .catch(err => {
    require('fs').writeFileSync('db_output.txt', err.message);
    process.exit(1);
  });
