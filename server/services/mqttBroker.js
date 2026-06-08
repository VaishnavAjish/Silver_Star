'use strict';

const { logger } = require('../middleware/logger');

const MQTT_URL = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883';
const TOPIC_PREFIX = 'silverstar';

let mqttClient = null;
let isConnected = false;
let pendingMessages = [];

const TOPIC_MAP = {
  'barcode.scanned':    'inventory.barcode.scanned',
  'device.status':      'manufacturing.machine.status_changed',
  'warehouse.stock':    'inventory.stock.changed',
  'iot.sensor':         'dashboard.sensor.updated',
};

function mapToEvent(mqttTopic, payload) {
  const suffix = mqttTopic.startsWith(`${TOPIC_PREFIX}/iot/`) ? mqttTopic.slice(`${TOPIC_PREFIX}/iot/`.length) : mqttTopic;
  return TOPIC_MAP[suffix] || `iot.${suffix.replace(/\//g, '.')}`;
}

function mapFromEvent(eventTopic) {
  const parts = eventTopic.split('.');
  const category = parts[0];
  return `${TOPIC_PREFIX}/${category}/${parts.slice(1).join('/')}`;
}

async function startMqttBroker() {
  let mqtt;
  try {
    mqtt = require('mqtt');
  } catch {
    logger.info('[MQTT] mqtt package not installed; running in bridge-only mode');
    return;
  }
  try {
    mqttClient = mqtt.connect(MQTT_URL, {
      clientId: `silverstar-grow-${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
    });
    mqttClient.on('connect', () => {
      isConnected = true;
      logger.info(`[MQTT] Connected to ${MQTT_URL}`);
      mqttClient.subscribe(`${TOPIC_PREFIX}/iot/#`, { qos: 1 });
      for (const msg of pendingMessages) {
        mqttClient.publish(msg.topic, msg.payload, { qos: 1 });
      }
      pendingMessages = [];
    });
    mqttClient.on('message', (topic, buffer) => {
      try {
        const payload = JSON.parse(buffer.toString());
        const eventTopic = mapToEvent(topic, payload);
        const { dispatchEvent } = require('./eventDispatcher');
        dispatchEvent(eventTopic, { ...payload, _fromMqtt: true }).catch(() => {});
      } catch (err) {
        logger.warn(`[MQTT] Failed to handle message on ${topic}: ${err.message}`);
      }
    });
    mqttClient.on('error', (err) => {
      logger.warn(`[MQTT] Error: ${err.message}`);
    });
    mqttClient.on('close', () => { isConnected = false; });
  } catch (err) {
    logger.warn(`[MQTT] Failed to connect: ${err.message}`);
  }
}

async function stopMqttBroker() {
  if (mqttClient) {
    mqttClient.end(true);
    mqttClient = null;
  }
  isConnected = false;
  pendingMessages = [];
  logger.info('[MQTT] Disconnected');
}

async function publish(eventTopic, payload) {
  const mqttTopic = mapFromEvent(eventTopic);
  const data = JSON.stringify({ ...payload, _source: 'erp', timestamp: new Date().toISOString() });
  if (mqttClient && isConnected) {
    mqttClient.publish(mqttTopic, data, { qos: 1 });
  } else {
    pendingMessages.push({ topic: mqttTopic, payload: data });
  }
}

module.exports = { startMqttBroker, stopMqttBroker, publish };
