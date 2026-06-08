const { randomUUID } = require('crypto');

const LOG_LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.INFO;

function formatLog(level, msg, meta = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    correlationId: meta.correlationId || globalCorrelationId || '-',
    message: msg,
    ...meta,
    ...(meta.duration != null ? { duration_ms: meta.duration } : {}),
    ...(meta.error ? { error: meta.error instanceof Error ? meta.error.message : meta.error, stack: meta.error instanceof Error ? meta.error.stack?.split('\n').slice(0, 3).join(';') : undefined } : {}),
  });
}

let globalCorrelationId = null;

function setGlobalCorrelationId(id) {
  globalCorrelationId = id;
}

const logger = {
  error: (msg, meta) => { if (CURRENT_LEVEL >= LOG_LEVELS.ERROR) console.error(formatLog('ERROR', msg, meta)); },
  warn: (msg, meta) => { if (CURRENT_LEVEL >= LOG_LEVELS.WARN) console.warn(formatLog('WARN', msg, meta)); },
  info: (msg, meta) => { if (CURRENT_LEVEL >= LOG_LEVELS.INFO) console.log(formatLog('INFO', msg, meta)); },
  debug: (msg, meta) => { if (CURRENT_LEVEL >= LOG_LEVELS.DEBUG) console.log(formatLog('DEBUG', msg, meta)); },
  child: (defaultMeta) => {
    return Object.keys(logger).reduce((acc, key) => {
      if (typeof logger[key] === 'function') {
        acc[key] = (msg, meta) => logger[key](msg, { ...defaultMeta, ...meta });
      }
      return acc;
    }, {});
  },
};

function correlationIdMiddleware(req, res, next) {
  const correlationId = req.headers['x-correlation-id'] || randomUUID();
  req.correlationId = correlationId;
  setGlobalCorrelationId(correlationId);
  res.setHeader('x-correlation-id', correlationId);
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](`${req.method} ${req.originalUrl} ${res.statusCode}`, {
      correlationId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration,
      contentLength: res.getHeader('content-length'),
      userAgent: req.headers['user-agent'],
    });
    if (duration > (parseInt(process.env.SLOW_THRESHOLD_MS) || 5000)) {
      logger.warn(`SLOW_REQUEST ${req.method} ${req.originalUrl}`, {
        correlationId, duration, method: req.method, url: req.originalUrl,
      });
    }
  });
  next();
}

module.exports = { logger, correlationIdMiddleware, setGlobalCorrelationId, LOG_LEVELS };
