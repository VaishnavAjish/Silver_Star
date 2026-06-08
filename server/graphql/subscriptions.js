'use strict';

const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(200);

const TOPIC_MAP = {
  'revenue.updated':          'revenueUpdated',
  'expenses.updated':         'expensesUpdated',
  'netprofit.updated':        'netProfitUpdated',
  'inventory.created':        'inventoryCreated',
  'inventory.updated':        'inventoryUpdated',
  'inventory.deleted':        'inventoryDeleted',
  'inventory.stock.changed':  'inventoryStockChanged',
  'sale.created':             'saleCreated',
  'sale.updated':             'saleUpdated',
  'purchase.created':         'purchaseCreated',
  'purchase.updated':         'purchaseUpdated',
  'journal.posted':           'journalPosted',
  'dashboard.refresh':        'dashboardRefreshed',
  'notification.created':     'notificationReceived',
  'presence.update':          'presenceUpdated',
};

const REVERSE_MAP = {};
for (const [k, v] of Object.entries(TOPIC_MAP)) REVERSE_MAP[v] = k;

function publish(erpTopic, payload) {
  const graphqlTopic = TOPIC_MAP[erpTopic];
  if (graphqlTopic) {
    emitter.emit(graphqlTopic, { [graphqlTopic]: payload });
  }
}

function subscribe(graphqlTopic) {
  const eventName = graphqlTopic;
  return {
    [Symbol.asyncIterator]() {
      const buffer = [];
      let resolve = null;
      const handler = (data) => {
        if (resolve) {
          resolve({ value: data, done: false });
          resolve = null;
        } else {
          buffer.push(data);
        }
      };
      emitter.on(eventName, handler);
      return {
        next() {
          if (buffer.length) {
            const value = buffer.shift();
            return Promise.resolve({ value, done: false });
          }
          return new Promise(r => { resolve = r; });
        },
        return() {
          emitter.off(eventName, handler);
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

function bridgeFromDispatcher() {
  const { dispatchEvent } = require('../services/eventDispatcher');
  const original = dispatchEvent;
  return true;
}

module.exports = { publish, subscribe, TOPIC_MAP, bridgeFromDispatcher };
