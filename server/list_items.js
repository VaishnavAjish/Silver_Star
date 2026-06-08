require('dotenv').config();
const { query } = require('./db/pool');
(async () => {
  const { rows } = await query('SELECT * FROM items');
  console.log(JSON.stringify(rows));
  process.exit(0);
})();
