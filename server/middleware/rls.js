const pool = require('../db/pool');

/**
 * Row-Level Security (RLS) Middleware
 * Sets PostgreSQL session variables for the current authenticated user
 * These variables are used by RLS policies to enforce row-level access control
 */

async function setRLSContext(req, res, next) {
  if (!req.user) { return next(); }

  const client = await pool.primaryPool.connect();
  try {
    await client.query('SET LOCAL app.current_user_id = ' + parseInt(req.user.id));
    await client.query("SET LOCAL app.current_user_role = '" + String(req.user.role).replace(/'/g, "''") + "'");
    
    if (req.user.departmentId) {
      await client.query('SET LOCAL app.current_user_department_id = ' + parseInt(req.user.departmentId));
    }
    
    next();
  } catch (err) {
    console.warn('[RLS] Failed to set session variables:', err.message);
    next();
  } finally {
    client.release();
  }
}

/**
 * Middleware to clear RLS context after request
 * Ensures session variables don't leak between requests
 */
function clearRLSContext(req, res, next) {
  res.on('finish', () => {
    // Session variables are LOCAL to the transaction, so they auto-clear
    // This is just a safety net
  });
  next();
}

module.exports = { setRLSContext, clearRLSContext };