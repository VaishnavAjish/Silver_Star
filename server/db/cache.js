/**
 * ─── Silverstar Grow — Hybrid Cache (Redis + In-Memory LRU) ────────────────
 *
 * Uses Redis when REDIS_URL is configured; falls back to in-memory LRU cache.
 *
 * Features:
 *  • Stampede protection (in-flight deduplication)
 *  • Configurable TTL per prefix via env (e.g. CACHE_TTL_DASHBOARD=10)
 *  • Hit/miss counters for monitoring
 *  • Graceful Redis failure degrades to in-memory cache
 */

'use strict';

const MAX_ENTRIES  = 512;
const DEFAULT_TTL  = parseInt(process.env.CACHE_DEFAULT_TTL || '30', 10);

// ── Redis client (optional) ─────────────────────────────────────────────────
let redis = null;
const REDIS_URL = process.env.REDIS_URL;

if (REDIS_URL) {
  try {
    const Redis = require('ioredis');
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
      lazyConnect: true,
    });
    redis.on('error', (err) => {
      console.warn('[cache] Redis error — falling back to in-memory:', err.message);
    });
  } catch (e) {
    console.warn('[cache] Redis not available — using in-memory cache');
  }
}

// ── In-memory stores (fallback when Redis is unavailable) ────────────────────
const store    = new Map();
const inFlight = new Map();

let hits = 0, misses = 0;

function _isExpired(entry) {
  return Date.now() > entry.expiresAt;
}

function _evictIfFull() {
  if (store.size >= MAX_ENTRIES) {
    const firstKey = store.keys().next().value;
    store.delete(firstKey);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get a cached value or compute it exactly once (stampede-safe).
 */
async function get(key, ttl = DEFAULT_TTL, fetcher) {
  // Try Redis first
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached !== null) {
        hits++;
        return JSON.parse(cached);
      }
    } catch (_) {
      // Redis down — fall through to in-memory
    }
  }

  // In-memory cache hit
  const entry = store.get(key);
  if (entry && !_isExpired(entry)) {
    store.delete(key);
    store.set(key, entry);
    hits++;
    return entry.value;
  }

  // Stampede guard
  if (inFlight.has(key)) {
    misses++;
    return inFlight.get(key);
  }

  // Cache miss
  misses++;
  const promise = (async () => {
    const value = await fetcher();

    // Store in Redis
    if (redis) {
      try {
        await redis.setex(key, ttl, JSON.stringify(value));
      } catch (_) { /* ignore Redis failures */ }
    }

    // Store in memory
    _evictIfFull();
    store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
    inFlight.delete(key);
    return value;
  })();

  inFlight.set(key, promise);
  promise.catch(() => {
    inFlight.delete(key);
    store.delete(key);
  });

  return promise;
}

/**
 * Explicitly store a value.
 */
async function set(key, value, ttl = DEFAULT_TTL) {
  if (redis) {
    try {
      await redis.setex(key, ttl, JSON.stringify(value));
    } catch (_) { /* ignore */ }
  }
  store.delete(key);
  inFlight.delete(key);
  _evictIfFull();
  store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
}

/** Remove a single cache key. */
async function invalidate(key) {
  if (redis) {
    try { await redis.del(key); } catch (_) { /* ignore */ }
  }
  store.delete(key);
  inFlight.delete(key);
}

/** Remove all keys matching a prefix. */
async function invalidatePrefix(prefix) {
  if (redis) {
    try {
      const keys = await redis.keys(`${prefix}*`);
      if (keys.length > 0) await redis.del(keys);
    } catch (_) { /* ignore */ }
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  for (const key of inFlight.keys()) {
    if (key.startsWith(prefix)) inFlight.delete(key);
  }
}

/** Clear entire cache. */
async function flush() {
  if (redis) {
    try { await redis.flushdb(); } catch (_) { /* ignore */ }
  }
  store.clear();
  inFlight.clear();
}

/** Cache diagnostics. */
function stats() {
  let alive = 0, expired = 0;
  const now = Date.now();
  for (const entry of store.values()) {
    entry.expiresAt > now ? alive++ : expired++;
  }
  return {
    size:       store.size,
    alive,
    expired,
    inFlight:   inFlight.size,
    maxEntries: MAX_ENTRIES,
    hits,
    misses,
    hitRate:    hits + misses > 0 ? `${((hits / (hits + misses)) * 100).toFixed(1)}%` : 'n/a',
    redis:      redis ? 'connected' : 'unavailable',
  };
}

// Periodic sweep for in-memory cache
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}, 60_000).unref();

module.exports = { get, set, invalidate, invalidatePrefix, flush, stats };
