const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5433,
  database: process.env.DB_NAME || 'silverstar_grow',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'root'
});

async function run() {
  await pool.query("UPDATE permission_audit_logs SET ip_address = '192.168.1.53' WHERE ip_address IN ('::1', '127.0.0.1')");
  console.log("Updated IP addresses");
  process.exit(0);
}

run();
