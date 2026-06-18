'use strict';

/**
 * SSE Client Manager
 * Tracks all connected browser clients and broadcasts events to them.
 */

const clients = new Set();

function addClient(res) {
  clients.add(res);
}

function removeClient(res) {
  clients.delete(res);
}

/**
 * Broadcast an event to ALL connected SSE clients.
 * @param {string} topic  e.g. 'inventory.created'
 * @param {object} data   event payload
 */
function broadcast(topic, data) {
  if (clients.size === 0) return;
  const message = `event: ${topic}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
  for (const client of clients) {
    try {
      client.write(message);
    } catch (_) {
      clients.delete(client);
    }
  }
}

function getClientCount() {
  return clients.size;
}

module.exports = { addClient, removeClient, broadcast, getClientCount };
