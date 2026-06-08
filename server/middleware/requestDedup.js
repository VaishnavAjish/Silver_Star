const { logger } = require('./logger');

const inflight = new Map();
const CACHE = new Map();
const CACHE_TTL = 2000;

function requestKey(req) {
  const body = req.method === 'GET' ? '' : (req.body ? JSON.stringify(req.body) : '');
  return `${req.method}:${req.originalUrl}:${body}`;
}

function requestDedupMiddleware(req, res, next) {
  if (req.method !== 'GET') return next();

  const key = requestKey(req);

  const cached = CACHE.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    logger.debug('Cache hit', { key, url: req.originalUrl });
    return res.json(cached.data);
  }

  const pending = inflight.get(key);
  if (pending) {
    logger.debug('Dedup hit', { key, url: req.originalUrl });
    pending.push({ res });
    return;
  }

  inflight.set(key, []);
  const originalJson = res.json.bind(res);
  res.json = function (data) {
    CACHE.set(key, { data, ts: Date.now() });
    const waiters = inflight.get(key);
    inflight.delete(key);
    originalJson(data);
    if (waiters) {
      waiters.forEach(w => w.res.json(data));
    }
  };

  res.on('close', () => {
    if (inflight.has(key)) {
      const waiters = inflight.get(key);
      inflight.delete(key);
      if (waiters) waiters.forEach(w => { w.res.status(503).json({ error: 'Request cancelled' }); });
    }
  });

  next();
}

function clearCache() { CACHE.clear(); inflight.clear(); }

// Evict stale entries every 30 s so the Map doesn't grow unboundedly
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of CACHE) {
    if (now - entry.ts >= CACHE_TTL) CACHE.delete(key);
  }
}, 30_000).unref();

module.exports = { requestDedupMiddleware, clearCache };
