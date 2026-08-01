const { randomUUID } = require('crypto');

const LOG_LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.INFO;

// In-memory ring buffer for Backend System Logs (Super Admin Logger)
const MAX_BUFFER_SIZE = 1000;
const backendLogsBuffer = [];
let logIdCounter = 1;

function formatLog(level, msg, meta = {}) {
  const timestamp = new Date().toISOString();
  const category = meta.category || meta.module || 'default';
  const formattedString = `[${timestamp}] [${level}] ${category} - ${msg}${meta.error ? ` (${meta.error})` : ''}`;

  // Push into ring buffer for live logger UI
  if (backendLogsBuffer.length >= MAX_BUFFER_SIZE) {
    backendLogsBuffer.shift();
  }
  backendLogsBuffer.push({
    id: logIdCounter++,
    timestamp,
    level,
    category,
    message: msg,
    formatted: formattedString,
    meta,
  });

  return JSON.stringify({
    timestamp,
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

function getBackendLogs({ level = 'ALL', limit = 500 } = {}) {
  let logs = [...backendLogsBuffer];
  if (level && level !== 'ALL') {
    logs = logs.filter(l => l.level === level.toUpperCase());
  }
  return logs.slice(-limit);
}

function clearBackendLogs() {
  backendLogsBuffer.length = 0;
}

function pushSystemLog(level, msg, category = 'system') {
  formatLog(level, msg, { category });
}

function correlationIdMiddleware(req, res, next) {
  const correlationId = req.headers['x-correlation-id'] || randomUUID();
  req.correlationId = correlationId;
  setGlobalCorrelationId(correlationId);
  res.setHeader('x-correlation-id', correlationId);
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
    const category = req.originalUrl.split('?')[0].split('/')[2] || 'api';
    formatLog(level, `${req.method} ${req.originalUrl} ${res.statusCode}`, {
      category,
      correlationId,
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      duration,
      contentLength: res.getHeader('content-length'),
      userAgent: req.headers['user-agent'],
    });
    if (duration > (parseInt(process.env.SLOW_THRESHOLD_MS) || 5000)) {
      formatLog('WARN', `SLOW_REQUEST ${req.method} ${req.originalUrl}`, {
        category: 'performance',
        correlationId, duration, method: req.method, url: req.originalUrl,
      });
    }
  });
  next();
}

module.exports = {
  logger,
  correlationIdMiddleware,
  setGlobalCorrelationId,
  LOG_LEVELS,
  getBackendLogs,
  clearBackendLogs,
  pushSystemLog,
};
