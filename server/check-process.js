const { Client } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});
client.connect().then(() => {
  return client.query('SELECT process_code, allowed_outputs FROM process_master');
}).then(res => {
  console.log("Found process codes:");
  res.rows.forEach(r => console.log(`- '${r.process_code}' (outputs: ${r.allowed_outputs ? JSON.stringify(r.allowed_outputs) : 'null'})`));
  client.end();
}).catch(console.error);
