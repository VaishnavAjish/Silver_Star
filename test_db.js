const { Pool } = require('pg');

const pool = new Pool({
  host: '192.168.1.211',
  port: 5433,
  database: 'silverstar_grow',
  user: 'postgres',
  password: 'Nidhi',
  ssl: false,
  connectionTimeoutMillis: 5000,
});

(async () => {
  try {
    console.log('Testing connection...');
    const client = await pool.connect();
    console.log('Connected successfully!');
    
    const result = await client.query('SELECT version()');
    console.log('PostgreSQL version:', result.rows[0].version);
    
    const tables = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('users', 'refresh_tokens', 'login_attempts', 'sys_event_outbox', 'inventory')`);
    console.log('Tables:', tables.rows);
    
    if (tables.rows.length > 0) {
      const users = await client.query(`SELECT id, username, role, is_active, mfa_enabled, last_login FROM users WHERE username = 'admin'`);
      console.log('Admin user:', users.rows[0]);
    }
    
    client.release();
  } catch (e) {
    console.error('Error:', e.message, e.code);
  } finally {
    await pool.end();
  }
})();