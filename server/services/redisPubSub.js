const Redis = require('ioredis');
const { logger } = require('../middleware/logger');

const NAMESPACE = 'silverstar:events:';

let pubClient = null;
let subClient = null;
let subscribed = false;

function createClient(label) {
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 200, 3000);
    },
    lazyConnect: true,
  });
  client.on('error', (err) => {
    logger.warn(`[RedisPubSub:${label}] Connection error: ${err.message}`);
  });
  return client;
}

async function startRedisPubSub() {
  try {
    pubClient = createClient('pub');
    subClient = createClient('sub');
    await Promise.all([pubClient.connect(), subClient.connect()]);
    logger.info('[RedisPubSub] Connected');
    await subClient.psubscribe(`${NAMESPACE}*`);
    subscribed = true;
    subClient.on('pmessage', (_pattern, channel, message) => {
      const topic = channel.slice(NAMESPACE.length);
      try {
        const payload = JSON.parse(message);
        // Lazy-require to avoid circular deps
        const { dispatchEvent } = require('./eventDispatcher');
        dispatchEvent(topic, payload).catch(() => {});
      } catch (err) {
        logger.warn(`[RedisPubSub] Failed to handle ${channel}: ${err.message}`);
      }
    });
    logger.info('[RedisPubSub] Subscribed to silverstar:events:*');
  } catch (err) {
    logger.warn(`[RedisPubSub] Failed to start (Redis unavailable?): ${err.message}`);
    pubClient = null;
    subClient = null;
  }
}

async function stopRedisPubSub() {
  subscribed = false;
  for (const c of [subClient, pubClient]) {
    if (c) try { await c.quit(); } catch {}
  }
  pubClient = null;
  subClient = null;
  logger.info('[RedisPubSub] Disconnected');
}

async function publish(topic, payload) {
  if (!pubClient) return false;
  try {
    await pubClient.publish(`${NAMESPACE}${topic}`, JSON.stringify(payload));
    return true;
  } catch (err) {
    logger.warn(`[RedisPubSub] Publish failed for ${topic}: ${err.message}`);
    return false;
  }
}

function getRedisClients() {
  return { pub: pubClient, sub: subClient };
}

module.exports = { startRedisPubSub, stopRedisPubSub, publish, getRedisClients };
