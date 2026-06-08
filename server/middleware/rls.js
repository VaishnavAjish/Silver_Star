'use strict';

const pool = require('../db/pool');

/**
 * Row-Level Security (RLS) Middleware
 *
 * IMPORTANT: SET LOCAL only affects the current connection for the duration
 * of a transaction. We must attach a dedicated pg client to req so the same
 * connection is used for both the RLS setup AND the actual query in route
 * handlers. The client is released in the response finish handler.
 *
 * Routes that need RLS must use req.db (the pinned client) instead of
 * pool.query() — or call pool.query() and accept that RLS won't apply to
 * those queries (fine for super_admin or non-RLS tables).
 */
async function setRLSContext(req, res, next) {
  if (!req.user) return next();

  try {
    const client = await pool.primaryPool.connect();
    req.db = client;

    // Release when the response is fully sent
    const release = () => {
      if (req.db) {
        req.db.release();
        req.db = null;
      }
    };
    res.on('finish', release);
    res.on('close', release);

    await client.query('BEGIN');
    await client.query(
      `SET LOCAL app.current_user_id = ${parseInt(req.user.id, 10)}`
    );
    await client.query(
      `SET LOCAL app.current_user_role = '${String(req.user.role).replace(/'/g, "''")}'`
    );
    if (req.user.departmentId) {
      await client.query(
        `SET LOCAL app.current_user_department_id = ${parseInt(req.user.departmentId, 10)}`
      );
    }

    // Intercept res.json/res.send to COMMIT before sending
    const _json = res.json.bind(res);
    res.json = (body) => {
      if (req.db) req.db.query('COMMIT').catch(() => {}).finally(() => _json(body));
      else _json(body);
    };

    next();
  } catch (err) {
    console.warn('[RLS] Failed to pin client or set session variables:', err.message);
    next(); // degrade gracefully — routes still work, just without RLS
  }
}

module.exports = { setRLSContext };
