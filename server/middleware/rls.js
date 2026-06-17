'use strict';

const pool = require('../db/pool');

/**
 * Row-Level Security (RLS) Middleware
 *
 * We attach a dedicated pg client to req so the same
 * connection is used for both the RLS setup AND the actual query in route
 * handlers. The client is released in the response finish handler.
 * By wrapping the execution with rlsContext, all subsequent pool.query()
 * calls automatically inherit this RLS-enabled client.
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

    pool.rlsContext.run(client, () => {
      next();
    });
  } catch (err) {
    console.warn('[RLS] Failed to pin client or set session variables:', err.message);
    next(); // degrade gracefully — routes still work, just without RLS
  }
}

module.exports = { setRLSContext };
