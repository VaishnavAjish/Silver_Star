'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: false,
});

const sqlFile = path.join(__dirname, 'migrations', 'phase40_realtime_infrastructure.sql');
const sql = fs.readFileSync(sqlFile, 'utf8');

pool.query(sql)
  .then(results => {
    const rows = Array.isArray(results)
      ? results[results.length - 1]?.rows
      : results?.rows;
    console.log('=== Phase 40 Migration Result ===');
    if (rows) rows.forEach(r => console.log(' ', r.table_name, ':', r.row_count));
    console.log('\n✅ Migration phase40_realtime_infrastructure applied successfully');
    pool.end();
  })
  .catch(err => {
    console.error('❌ Migration error:', err.message);
    pool.end();
    process.exit(1);
  });
