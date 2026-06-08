const { logger } = require('./logger');

const counters = {
  http_requests_total: 0,
  http_requests_active: 0,
  http_errors_total: 0,
  db_queries_total: 0,
  db_queries_slow_total: 0,
  cache_hits_total: 0,
  cache_misses_total: 0,
  queue_jobs_total: 0,
  queue_jobs_failed: 0,
};

const histograms = {
  http_request_duration_ms: [],
  db_query_duration_ms: [],
};

const MAX_HISTOGRAM_SAMPLES = 1000;

function recordHistogram(name, value) {
  if (histograms[name].length >= MAX_HISTOGRAM_SAMPLES) {
    histograms[name].shift();
  }
  histograms[name].push(value);
}

function metricsMiddleware(req, res, next) {
  counters.http_requests_total++;
  counters.http_requests_active++;
  const start = Date.now();
  res.on('finish', () => {
    counters.http_requests_active--;
    const duration = Date.now() - start;
    recordHistogram('http_request_duration_ms', duration);
    if (res.statusCode >= 400) counters.http_errors_total++;
  });
  next();
}

function metricsEndpoint(req, res) {
  const p50 = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a,b) => a-b); return s[Math.floor(s.length * 0.5)]; };
  const p95 = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a,b) => a-b); return s[Math.floor(s.length * 0.95)]; };
  const p99 = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((a,b) => a-b); return s[Math.floor(s.length * 0.99)]; };

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  const lines = [
    `# HELP http_requests_total Total HTTP requests`,
    `# TYPE http_requests_total counter`,
    `http_requests_total ${counters.http_requests_total}`,
    ``,
    `# HELP http_requests_active Active HTTP requests`,
    `# TYPE http_requests_active gauge`,
    `http_requests_active ${counters.http_requests_active}`,
    ``,
    `# HELP http_errors_total Total HTTP errors (4xx/5xx)`,
    `# TYPE http_errors_total counter`,
    `http_errors_total ${counters.http_errors_total}`,
    ``,
    `# HELP http_request_duration_ms HTTP request duration`,
    `# TYPE http_request_duration_ms histogram`,
    `http_request_duration_ms_p50 ${p50(histograms.http_request_duration_ms)}`,
    `http_request_duration_ms_p95 ${p95(histograms.http_request_duration_ms)}`,
    `http_request_duration_ms_p99 ${p99(histograms.http_request_duration_ms)}`,
    `http_request_duration_ms_count ${histograms.http_request_duration_ms.length}`,
    ``,
    `# HELP db_queries_total Total database queries`,
    `# TYPE db_queries_total counter`,
    `db_queries_total ${counters.db_queries_total}`,
    ``,
    `# HELP db_queries_slow_total Slow database queries (>1s)`,
    `# TYPE db_queries_slow_total counter`,
    `db_queries_slow_total ${counters.db_queries_slow_total}`,
    ``,
    `# HELP cache_hits_total Cache hit count`,
    `# TYPE cache_hits_total counter`,
    `cache_hits_total ${counters.cache_hits_total}`,
    ``,
    `# HELP cache_misses_total Cache miss count`,
    `# TYPE cache_misses_total counter`,
    `cache_misses_total ${counters.cache_misses_total}`,
    ``,
    `# HELP queue_jobs_total Total queue jobs processed`,
    `# TYPE queue_jobs_total counter`,
    `queue_jobs_total ${counters.queue_jobs_total}`,
    ``,
    `# HELP queue_jobs_failed Failed queue jobs`,
    `# TYPE queue_jobs_failed counter`,
    `queue_jobs_failed ${counters.queue_jobs_failed}`,
    ``,
    `# HELP db_query_duration_ms Database query duration`,
    `# TYPE db_query_duration_ms histogram`,
    `db_query_duration_ms_p50 ${p50(histograms.db_query_duration_ms)}`,
    `db_query_duration_ms_p95 ${p95(histograms.db_query_duration_ms)}`,
    `db_query_duration_ms_p99 ${p99(histograms.db_query_duration_ms)}`,
    `db_query_duration_ms_count ${histograms.db_query_duration_ms.length}`,
    ``,
    `# HELP process_uptime_seconds Process uptime`,
    `# TYPE process_uptime_seconds gauge`,
    `process_uptime_seconds ${Math.floor(process.uptime())}`,
    ``,
    `# HELP process_memory_bytes Process memory usage`,
    `# TYPE process_memory_bytes gauge`,
    `process_memory_heap_used ${process.memoryUsage().heapUsed}`,
    `process_memory_heap_total ${process.memoryUsage().heapTotal}`,
    `process_memory_rss ${process.memoryUsage().rss}`,
    `process_memory_external ${process.memoryUsage().external}`,
  ];
  res.end(lines.join('\n'));
}

function recordDbQuery(durationMs) {
  counters.db_queries_total++;
  recordHistogram('db_query_duration_ms', durationMs);
  if (durationMs > 1000) counters.db_queries_slow_total++;
}

function recordCacheHit() { counters.cache_hits_total++; }
function recordCacheMiss() { counters.cache_misses_total++; }
function recordQueueJob() { counters.queue_jobs_total++; }
function recordQueueJobFailed() { counters.queue_jobs_failed++; }

module.exports = {
  metricsMiddleware,
  metricsEndpoint,
  recordDbQuery,
  recordCacheHit,
  recordCacheMiss,
  recordQueueJob,
  recordQueueJobFailed,
};
