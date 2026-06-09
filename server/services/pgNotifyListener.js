'use strict';

const pool = require('../db/pool');
const { dispatchEvent } = require('./eventDispatcher');
const { logger } = require('../middleware/logger');

const CHANNEL_PREFIX = 'pg_';
const DEDUP_TTL = 5 * 60 * 1000;
const processedEvents = new Map();

const TABLE_EVENT_MAP = {
  inventory:               { created: 'inventory.created',     updated: 'inventory.updated',     deleted: 'inventory.deleted' },
  journal_entries:         { created: 'journal.created',      updated: 'journal.updated',      deleted: 'journal.deleted' },
  purchase_notes:          { created: 'purchase.created',     updated: 'purchase.updated',     deleted: 'purchase.deleted' },
  invoices:                { created: 'sale.created',         updated: 'sale.updated',         deleted: 'sale.deleted' },
  payments:                { created: 'payment.created',      updated: 'payment.updated',      deleted: 'payment.deleted' },
  receipts:                { created: 'receipt.created',      updated: 'receipt.updated',      deleted: 'receipt.deleted' },
  expenses:                { created: 'expense.created',      updated: 'expense.updated',      deleted: 'expense.deleted' },
  accounts:                { created: 'master.created',       updated: 'master.updated',       deleted: 'master.deleted' },
  items:                   { created: 'master.created',       updated: 'master.updated',       deleted: 'master.deleted' },
  vendors:                 { created: 'vendor.created',       updated: 'vendor.updated',       deleted: 'vendor.deleted' },
  customers:               { created: 'customer.created',     updated: 'customer.updated',     deleted: 'customer.deleted' },
  users:                   { created: 'user.created',         updated: 'user.updated',         deleted: 'user.deleted' },
  user_roles:              { created: 'role.assigned',        updated: 'permission.changed',   deleted: 'role.assigned' },
  role_permissions:        { created: 'permission.changed',   updated: 'permission.changed',   deleted: 'permission.changed' },
  process_transactions:    { created: 'process.started',      updated: 'process.completed',    deleted: 'process.cancelled' },
  rough_growth:            { created: 'inventory.created',    updated: 'inventory.updated',    deleted: 'inventory.deleted' },
  departments:             { created: 'master.created',       updated: 'master.updated',       deleted: 'master.deleted' },
  locations:               { created: 'master.created',       updated: 'master.updated',       deleted: 'master.deleted' },
  machines:                { created: 'master.created',       updated: 'master.updated',       deleted: 'master.deleted' },
  fixed_assets:            { created: 'asset.created',        updated: 'asset.updated',        deleted: 'asset.deleted' },
  fixed_asset_categories:  { created: 'master.created',       updated: 'master.updated',       deleted: 'master.deleted' },
  audit_logs:              { created: 'audit.created',        updated: null,                   deleted: null },
  lot_movements:           { created: 'lot.split',            updated: 'lot.merged',           deleted: null },
  cost_centers:            { created: 'master.created',       updated: 'master.updated',       deleted: 'master.deleted' },
  growth_runs:             { created: 'batch.created',        updated: 'batch.updated',        deleted: 'batch.closed' },
  bank_reconciliation:     { created: 'recon.created',        updated: 'recon.updated',        deleted: 'recon.deleted' },
  bank_deposits:           { created: 'bank_deposit.created',  updated: 'bank_deposit.updated',  deleted: 'bank_deposit.deleted' },
  asset_templates:         { created: 'asset_template.created', updated: 'asset_template.updated', deleted: 'asset_template.deleted' },
  depreciation_runs:       { created: 'depreciation.created',  updated: null,                    deleted: 'depreciation.cancelled' },
  je_allocations:          { created: 'je_allocation.created',  updated: null,                    deleted: 'je_allocation.deleted' },
  machine_processes:       { created: 'manufacturing.process.started',   updated: 'manufacturing.process.completed',   deleted: 'manufacturing.process.cancelled' },
  process_master:          { created: 'process_master.created', updated: 'process_master.updated', deleted: 'process_master.deleted' },
  login_attempts:          { created: null,                     updated: null,                    deleted: null },
  refresh_tokens:          { created: null,                     updated: null,                    deleted: null },
  user_preferences:        { created: null,                     updated: 'user.preferences.updated', deleted: null },
  user_permissions:        { created: 'permission.changed',     updated: 'permission.changed',    deleted: 'permission.changed' },
  user_dashboard_widgets:  { created: 'dashboard.widget.updated', updated: 'dashboard.widget.updated', deleted: 'dashboard.widget.updated' },
};

let listening = false;
let pgClient = null;

setInterval(() => {
  const cutoff = Date.now() - DEDUP_TTL;
  for (const [id, ts] of processedEvents) {
    if (ts < cutoff) processedEvents.delete(id);
  }
}, 60_000).unref();

async function startPgNotifyListener() {
  if (listening) return;
  listening = true;

  try {
    pgClient = await pool.primaryPool.connect();
    logger.info('[PGNotify] Connected, registering LISTEN channels...');

    const channels = Object.keys(TABLE_EVENT_MAP).flatMap(table =>
      ['INSERT', 'UPDATE', 'DELETE'].map(op => `${table}_${op}`)
    );

    for (const ch of channels) {
      await pgClient.query(`LISTEN "${ch}"`);
    }

    pgClient.on('notification', (msg) => {
      handleNotification(msg.channel, msg.payload);
    });

    pgClient.on('error', (err) => {
      logger.error('[PGNotify] Connection error, reconnecting...', { error: err.message });
      listening = false;
      pgClient = null;
      setTimeout(startPgNotifyListener, 3000);
    });

    logger.info('[PGNotify] Listening on ' + channels.length + ' channels');
  } catch (err) {
    logger.error('[PGNotify] Failed to start listener', { error: err.message });
    listening = false;
    pgClient = null;
    setTimeout(startPgNotifyListener, 5000);
  }
}

function handleNotification(channel, payloadStr) {
  try {
    const parts = channel.split('_');
    const op = parts.pop();
    const table = parts.join('_');

    const mapping = TABLE_EVENT_MAP[table];
    if (!mapping) return;

    const eventName = mapping[op.toLowerCase()];
    if (!eventName) return;

    const payload = payloadStr ? JSON.parse(payloadStr) : {};
    const eventId = payload.eventId || `${channel}_${payload.timestamp || Date.now()}_${payload.primary_id || ''}`;

    if (processedEvents.has(eventId)) return;

    processedEvents.set(eventId, Date.now());

    const eventPayload = {
      _source: 'pg_notify',
      eventId,
      table: payload.table,
      operation: payload.operation,
      timestamp: payload.timestamp,
      data: payload.new || payload.old || {},
    };

    dispatchEvent(eventName, eventPayload).catch(err =>
      logger.error('[PGNotify] dispatchEvent failed', { channel, error: err.message })
    );
  } catch (err) {
    logger.error('[PGNotify] Error processing notification', { channel, error: err.message });
  }
}

async function stopPgNotifyListener() {
  if (pgClient) {
    try {
      await pgClient.release();
    } catch (err) {
      logger.warn('[PGNotify] Error releasing client', { error: err.message });
    }
    pgClient = null;
  }
  listening = false;
}

module.exports = { startPgNotifyListener, stopPgNotifyListener };
