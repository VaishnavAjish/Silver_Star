const { Client } = require('pg');
const { dispatchEvent } = require('./eventDispatcher');

let pgClient = null;
let isShuttingDown = false;

// Channels defined in the database
const CHANNELS = [
  'inventory_updates',
  'purchase_updates',
  'sales_updates',
  'process_updates',
  'batch_updates',
  'master_updates'
];

async function startPgNotifyListener() {
  if (isShuttingDown) return;

  try {
    // Need a dedicated client connection for LISTEN
    pgClient = new Client({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'silverstar_grow',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    });

    await pgClient.connect();

    pgClient.on('notification', (msg) => {
      try {
        const payload = JSON.parse(msg.payload);
        const topic = payload.event || `${msg.channel.replace('_updates', '')}.${payload.action}`;
        
        // Pass to eventDispatcher
        dispatchEvent(topic, payload);
      } catch (err) {
        console.error('[pgNotifyListener] Payload parse error:', err.message);
      }
    });

    pgClient.on('error', (err) => {
      console.error('[pgNotifyListener] Connection error:', err.message);
      if (!isShuttingDown) {
        setTimeout(startPgNotifyListener, 5000);
      }
    });

    pgClient.on('end', () => {
      if (!isShuttingDown) {
        console.warn('[pgNotifyListener] Connection ended unexpectedly, reconnecting...');
        setTimeout(startPgNotifyListener, 5000);
      }
    });

    // Start listening
    for (const channel of CHANNELS) {
      await pgClient.query(`LISTEN ${channel}`);
    }

    console.log(`[pgNotifyListener] Listening for channels: ${CHANNELS.join(', ')}`);
  } catch (err) {
    console.error('[pgNotifyListener] Startup error:', err.message);
    if (!isShuttingDown) {
      setTimeout(startPgNotifyListener, 5000);
    }
  }
}

async function stopPgNotifyListener() {
  isShuttingDown = true;
  if (pgClient) {
    try {
      await pgClient.end();
      console.log('[pgNotifyListener] Stopped gracefully');
    } catch (err) {
      console.error('[pgNotifyListener] Shutdown error:', err.message);
    }
    pgClient = null;
  }
}

module.exports = {
  startPgNotifyListener,
  stopPgNotifyListener
};
