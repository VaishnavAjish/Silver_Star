/**
 * ─── Silverstar Grow — Centralized Error Handler ────────────────────────────
 *
 * Replaces scattered try/catch in every route with one place that:
 *  • maps every known error type to the correct HTTP status code
 *  • never leaks stack traces to the client in production
 *  • logs structured JSON to stderr (easily parsed by log aggregators)
 *  • generates a request-scoped correlation ID for traceability
 */
'use strict';

const { randomUUID } = require('crypto');

// ── Known error types → HTTP status map ──────────────────────────────────────
const PG_ERROR_MAP = {
  '23505': { status: 409, message: 'Duplicate record — this value already exists.' },
  '23503': { status: 409, message: 'Cannot delete — this record is referenced by other data.' },
  '23502': { status: 422, message: 'A required field is missing (database constraint).' },
  '23514': { status: 422, message: 'A field value violates a database check constraint.' },
  '42703': { status: 400, message: 'Unknown column referenced in query.' },
  '42P01': { status: 500, message: 'Database table not found. Schema may need migration.' },
  '42P10': { status: 500, message: 'Index mismatch error. Schema may need migration.' },
  '40001': { status: 503, message: 'Database serialization conflict — please retry.' },
  '40P01': { status: 503, message: 'Deadlock detected — please retry.' },
  '53300': { status: 503, message: 'Database connection pool exhausted. Too many requests.' },
  '57014': { status: 504, message: 'Query cancelled — execution time limit exceeded.' },
};

const isDev = process.env.NODE_ENV !== 'production';

/**
 * Attach a correlation ID to every incoming request.
 * Clients can pass X-Request-ID; otherwise we generate one.
 * This ID appears in all error logs so you can trace a request end-to-end.
 */
function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

/**
 * Wrap an async route handler so thrown errors reach the Express error handler.
 * Usage: router.get('/', asyncWrap(async (req, res) => { ... }));
 */
function asyncWrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * Global Express error handler — must have 4 parameters.
 * Mount LAST in app.js:  app.use(errorHandler);
 */
function errorHandler(err, req, res, next) {
  // Prevent double-sending if a route already committed a response
  if (res.headersSent) return;

  const requestId = req.requestId || 'unknown';
  let status  = err.status || err.statusCode || 500;
  let message = err.message || 'Internal server error';

  // ── PostgreSQL errors ─────────────────────────────────────────────────────
  if (err.code && PG_ERROR_MAP[err.code]) {
    const mapped = PG_ERROR_MAP[err.code];
    status  = mapped.status;
    message = mapped.message;
  }

  // ── JWT / Auth errors ─────────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    status  = 401;
    message = 'Invalid or expired authentication token.';
  }

  // ── Validation errors (e.g. from a manual throw) ──────────────────────────
  if (err.name === 'ValidationError') {
    status  = 422;
    message = err.message;
  }

  // ── CORS errors ───────────────────────────────────────────────────────────
  if (message.startsWith('CORS:')) {
    status  = 403;
    message = 'CORS policy violation.';
  }

  // ── Structured logging ────────────────────────────────────────────────────
  const logEntry = {
    level:     status >= 500 ? 'error' : 'warn',
    requestId,
    method:    req.method,
    path:      req.path,
    status,
    message,
    pgCode:    err.code || undefined,
    // Only include stack trace in dev — never in production
    stack:     isDev ? err.stack : undefined,
    timestamp: new Date().toISOString(),
  };

  if (status >= 500) {
    console.error(JSON.stringify(logEntry));
    require('fs').writeFileSync('last_500_error.json', JSON.stringify(logEntry, null, 2));
  } else if (status >= 400) {
    console.warn(JSON.stringify(logEntry));
  }

  // ── Client response — never expose internal details in production ─────────
  res.status(status).json({
    error:     message,
    requestId,
    ...(isDev && status >= 500 ? { stack: err.stack } : {}),
  });
}

/**
 * 404 handler — mount after all routes, before errorHandler.
 */
function notFound(req, res) {
  res.status(404).json({
    error:     `Route not found: ${req.method} ${req.path}`,
    requestId: req.requestId,
  });
}

module.exports = { requestId, asyncWrap, errorHandler, notFound };
