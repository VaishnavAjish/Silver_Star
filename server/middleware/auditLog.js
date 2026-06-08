/**
 * ─── Silverstar Grow — Audit Logging Middleware ────────────────────────────
 *
 * Logs all data mutations (POST/PUT/PATCH/DELETE) to the audit_logs table.
 * Must be mounted BEFORE route handlers.
 *
 * Usage:
 *   app.use('/api', auditLog);
 */

'use strict';

const pool = require('../db/pool');

/**
 * Middleware that logs mutation requests to the audit_logs table.
 * Captures method, path, user, IP, and request body snapshot.
 */
async function auditLog(req, res, next) {
  const start = Date.now();

  // Only log mutating requests
  const mutationMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!mutationMethods.includes(req.method)) {
    return next();
  }

  // Capture response status on finish
  res.on('finish', () => {
    const duration = Date.now() - start;

    // Don't block the response
    pool.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id,
        old_values, new_values, ip_address, user_agent, duration_ms, status_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        req.user?.id || null,
        `${req.method} ${req.path}`,
        req.path.split('/')[2] || null, // Extract table name from path
        req.params?.id ? parseInt(req.params.id) : null,
        null, // old_values — would need DB read before mutation
        req.body ? JSON.stringify(req.body).slice(0, 2000) : null,
        req.ip,
        req.headers['user-agent'] || null,
        duration,
        res.statusCode,
      ]
    ).catch((err) => {
      console.warn('[auditLog] Failed to write audit entry:', err.message);
    });
  });

  next();
}

/**
 * Ensure the audit_logs table exists.
 */
async function ensureAuditTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id          SERIAL PRIMARY KEY,
        timestamp   TIMESTAMP DEFAULT NOW(),
        user_id     INTEGER,
        action      TEXT NOT NULL,
        table_name  TEXT,
        record_id   BIGINT,
        old_values  TEXT,
        new_values  TEXT,
        ip_address  TEXT,
        user_agent  TEXT,
        duration_ms INTEGER DEFAULT 0,
        status_code INTEGER DEFAULT 200
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id)
    `);
  } catch (err) {
    console.warn('[auditLog] Table creation error:', err.message);
  }
}

// Initialize table on module load
ensureAuditTable();

module.exports = { auditLog, ensureAuditTable };
