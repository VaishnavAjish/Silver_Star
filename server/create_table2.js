require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'silverstar_grow',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
});

async function run() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        ip_address VARCHAR(45) NOT NULL,
        success BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    fs.writeFileSync('output.log', 'Table created successfully');
  } catch (e) {
    fs.writeFileSync('output.log', 'Error: ' + e.message + '\n' + e.stack);
  } finally {
    process.exit();
  }
}

run();
