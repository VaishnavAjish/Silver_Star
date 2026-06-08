'use strict';

const { logger } = require('../middleware/logger');
const pool = require('../db/pool');

const KAFKA_BROKERS = (process.env.KAFKA_BROKERS || '').split(',').filter(Boolean);
const TOPIC = 'silverstar.events';

let producer = null;
let consumer = null;
let isConnected = false;
let replayInterval = null;

function createKafkaClient() {
  let Kafka;
  try {
    Kafka = require('kafkajs').Kafka;
  } catch {
    return null;
  }
  return new Kafka({
    clientId: 'silverstar-grow',
    brokers: KAFKA_BROKERS,
    retry: { initialRetryTime: 1000, retries: 3 },
  });
}

async function startKafkaEventSink() {
  if (!KAFKA_BROKERS.length) {
    logger.info('[Kafka] No KAFKA_BROKERS configured; using outbox-only mode');
    startOutboxReplay();
    return;
  }
  try {
    const kafka = createKafkaClient();
    if (!kafka) {
      logger.info('[Kafka] kafkajs not installed; using outbox-only mode');
      startOutboxReplay();
      return;
    }
    producer = kafka.producer();
    await producer.connect();
    consumer = kafka.consumer({ groupId: 'silverstar-grow-group' });
    await consumer.connect();
    await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          const { topic: eventTopic, payload, timestamp } = JSON.parse(message.value.toString());
          const { dispatchEvent } = require('./eventDispatcher');
          await dispatchEvent(eventTopic, { ...payload, _fromKafka: true, _kafkaTimestamp: timestamp });
        } catch (err) {
          logger.warn(`[Kafka] Failed to process message: ${err.message}`);
        }
      },
    });
    isConnected = true;
    logger.info(`[Kafka] Connected to ${KAFKA_BROKERS.length} brokers, topic=${TOPIC}`);
    startOutboxReplay();
  } catch (err) {
    logger.warn(`[Kafka] Failed to connect: ${err.message}; using outbox-only mode`);
    startOutboxReplay();
  }
}

async function stopKafkaEventSink() {
  if (replayInterval) clearInterval(replayInterval);
  if (consumer) try { await consumer.disconnect(); } catch {}
  if (producer) try { await producer.disconnect(); } catch {}
  isConnected = false;
  logger.info('[Kafka] Disconnected');
}

async function produce(topic, payload) {
  try {
    const message = JSON.stringify({ topic, payload, timestamp: new Date().toISOString() });
    if (producer && isConnected) {
      await producer.send({ topic: TOPIC, messages: [{ key: topic, value: message }] });
    }
  } catch (err) {
    logger.warn(`[Kafka] Produce failed for ${topic}: ${err.message}`);
  }
}

function startOutboxReplay() {
  if (replayInterval) clearInterval(replayInterval);
  replayInterval = setInterval(async () => {
    try {
      const result = await pool.query(
        `SELECT id, topic, payload FROM sys_event_outbox
         WHERE created_at < NOW() - INTERVAL '1 minute'
         ORDER BY id ASC LIMIT 100`
      );
      for (const row of result.rows) {
        try {
          const { dispatchEvent } = require('./eventDispatcher');
          const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
          await dispatchEvent(row.topic, { ...payload, _replayed: true });
          await pool.query('DELETE FROM sys_event_outbox WHERE id = $1', [row.id]);
        } catch (err) {
          logger.warn(`[Kafka] Outbox replay failed for id=${row.id}: ${err.message}`);
        }
      }
    } catch (err) {
      logger.warn(`[Kafka] Outbox replay query failed: ${err.message}`);
    }
  }, 30000);
}

async function replayFromOutbox(options = {}) {
  const { limit = 1000, topicFilter } = options;
  const where = topicFilter ? 'WHERE topic LIKE $1' : '';
  const params = topicFilter ? [`${topicFilter}%`] : [];
  const result = await pool.query(
    `SELECT id, topic, payload FROM sys_event_outbox ${where} ORDER BY id ASC LIMIT ${parseInt(limit)}`,
    params.length ? params : undefined
  );
  const replayed = [];
  for (const row of result.rows) {
    try {
      const { dispatchEvent } = require('./eventDispatcher');
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      await dispatchEvent(row.topic, { ...payload, _replayed: true });
      await pool.query('DELETE FROM sys_event_outbox WHERE id = $1', [row.id]);
      replayed.push(row.id);
    } catch (err) {
      logger.warn(`[Kafka] Manual replay failed for id=${row.id}: ${err.message}`);
    }
  }
  return { replayed: replayed.length, total: result.rows.length };
}

module.exports = { startKafkaEventSink, stopKafkaEventSink, produce, replayFromOutbox };
