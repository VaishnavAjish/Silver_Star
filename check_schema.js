const pool = require('./server/db/pool');

(async () => {
  try {
    // Check if tables exist
    const tables = await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('refresh_tokens', 'login_attempts', 'sys_event_outbox')`);
    console.log('Tables:', tables.rows);
    
    // Check users table columns
    const usersCols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users' AND column_name IN ('mfa_secret_encrypted', 'mfa_encryption_version')`);
    console.log('User columns:', usersCols.rows);
    
    // Check inventory version column
    const invCols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'inventory' AND column_name = 'version'`);
    console.log('Inventory version:', invCols.rows);
    
    // Check if functions exist
    const funcs = await pool.query(`SELECT proname FROM pg_proc WHERE proname IN ('current_user_id', 'current_user_role', 'purge_old_events')`);
    console.log('Functions:', funcs.rows);
  } catch (e) {
    console.error('Error:', e.message);
  }
  process.exit(0);
})();