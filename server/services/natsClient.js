'use strict';

const { logger } = require('../middleware/logger');

const NATS_SERVERS = (process.env.NATS_SERVERS || 'nats://127.0.0.1:4222').split(',').filter(Boolean);
const SUBJECT_PREFIX = 'silverstar';

let nc = null;
let isConnected = false;
let sub = null;

function mapToSubject(eventTopic) {
  return `${SUBJECT_PREFIX}.${eventTopic.replace(/\./g, '.')}`;
}

function mapFromSubject(subject) {
  return subject.startsWith(`${SUBJECT_PREFIX}.`) ? subject.slice(`${SUBJECT_PREFIX}.`.length) : subject;
}

async function startNatsClient() {
  let nats;
  try {
    nats = require('nats');
  } catch {
    logger.info('[NATS] nats package not installed; running in bridge-only mode');
    return;
  }
  try {
    nc = await nats.connect({ servers: NATS_SERVERS, maxReconnectAttempts: 5, reconnectTimeWait: 2000 });
    isConnected = true;
    logger.info(`[NATS] Connected to ${NATS_SERVERS.join(', ')}`);
    sub = nc.subscribe(`${SUBJECT_PREFIX}.>`, { callback: (err, msg) => {
      if (err) { logger.warn(`[NATS] Subscription error: ${err.message}`); return; }
      try {
        const payload = JSON.parse(typeof msg.data === 'string' ? msg.data : new TextDecoder().decode(msg.data));
        const eventTopic = mapFromSubject(msg.subject);
        const { dispatchEvent } = require('./eventDispatcher');
        dispatchEvent(eventTopic, { ...payload, _fromNats: true }).catch(() => {});
      } catch (parseErr) {
        logger.warn(`[NATS] Failed to handle message on ${msg.subject}: ${parseErr.message}`);
      }
    }});
  } catch (err) {
    logger.warn(`[NATS] Failed to connect: ${err.message}`);
  }
}

async function stopNatsClient() {
  if (sub && nc) nc.drain(sub);
  if (nc) await nc.drain();
  nc = null;
  isConnected = false;
  logger.info('[NATS] Disconnected');
}

async function publish(eventTopic, payload) {
  if (!nc || !isConnected) return;
  try {
    const subject = mapToSubject(eventTopic);
    nc.publish(subject, JSON.stringify({ ...payload, _source: 'erp', timestamp: new Date().toISOString() }));
  } catch (err) {
    logger.warn(`[NATS] Publish failed for ${eventTopic}: ${err.message}`);
  }
}

module.exports = { startNatsClient, stopNatsClient, publish };
