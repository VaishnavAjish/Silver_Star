const { Pool } = require('pg');
const { logger } = require('../middleware/logger');
const { recordDbQuery } = require('../middleware/metrics');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'silverstar_grow',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: parseInt(process.env.DB_POOL_MAX) || 50,
  min: parseInt(process.env.DB_POOL_MIN) || 5,
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT) || 3000,
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT) || 25000,
  lock_timeout: parseInt(process.env.DB_LOCK_TIMEOUT) || 5000,
  idle_in_transaction_session_timeout: parseInt(process.env.DB_IDLE_TX_TIMEOUT) || 30000,
  // Keep TCP connections alive so stale sockets are detected quickly
  // instead of silently hanging for minutes on a dropped DB connection.
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

const primaryPool = new Pool(DB_CONFIG);

primaryPool.on('error', (err, client) => {
  logger.error('Unexpected error on idle primary client', { error: err.message, stack: err.stack });
});

// ── Read Replica Support ──────────────────────────────────────────────────
let replicaPools = [];
function initReplicas() {
  const replicaUrls = (process.env.DB_REPLICA_URLS || '').split(',').filter(Boolean);
  replicaPools = replicaUrls.map(url => {
    const p = new Pool({
      connectionString: url,
      max: parseInt(process.env.DB_POOL_MAX) || 50,
      min: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      statement_timeout: 60000,
    });
    p.on('error', (err) => logger.error('Unexpected error on idle replica client', { error: err.message }));
    return p;
  });
  if (replicaPools.length > 0) {
    logger.info(`Initialized ${replicaPools.length} read replicas`);
  }
}
initReplicas();

function getPool(readOnly = false) {
  if (readOnly && replicaPools.length > 0) {
    return replicaPools[Math.floor(Math.random() * replicaPools.length)];
  }
  return primaryPool;
}

// ── Query wrapper with monitoring ─────────────────────────────────────────
async function query(text, params, options = {}) {
  const pool = getPool(options.readOnly);
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    recordDbQuery(duration);
    if (duration > (parseInt(process.env.SLOW_QUERY_THRESHOLD_MS) || 1000)) {
      logger.warn('Slow query', {
        duration,
        text: text.substring(0, 200),
        paramsCount: params?.length,
      });
    }
    return result;
  } catch (err) {
    const duration = Date.now() - start;
    recordDbQuery(duration);
    logger.error('Query error', {
      error: err.message,
      text: text.substring(0, 200),
      duration,
      code: err.code,
    });
    throw err;
  }
}

// ── Transaction helper ────────────────────────────────────────────────────
async function transaction(callback) {
  const client = await primaryPool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Stream query (used by streaming middleware) ───────────────────────────
function streamQuery(text, params, options = {}) {
  const activePool = getPool(options.readOnly);
  return activePool.query({ text, values: params, rowMode: 'array' });
}

function poolStats() {
  const primary = {
    total: primaryPool.totalCount,
    idle: primaryPool.idleCount,
    waiting: primaryPool.waitingCount,
  };
  return { primary, replicas: replicaPools.length };
}

// ── Health check ──────────────────────────────────────────────────────────
async function healthCheck() {
  const start = Date.now();
  try {
    await primaryPool.query('SELECT 1');
    return { status: 'ok', latency: Date.now() - start, pool: poolStats() };
  } catch (err) {
    return { status: 'error', error: err.message, latency: Date.now() - start };
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────
async function shutdown() {
  logger.info('Shutting down database pools...');
  await primaryPool.end();
  for (const rp of replicaPools) await rp.end();
  logger.info('Database pools closed');
}

module.exports = { query, transaction, streamQuery, poolStats, healthCheck, primaryPool, shutdown };
