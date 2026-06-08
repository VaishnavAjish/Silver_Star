'use strict';

const { logger } = require('../middleware/logger');

let fbApp = null;
let rtdb = null;
let firestore = null;
let isConnected = false;

const COLLECTION_NAME = 'erp_events';

async function startFirebaseSync() {
  let admin;
  try {
    admin = require('firebase-admin');
  } catch {
    logger.info('[Firebase] firebase-admin not installed; running in bridge-only mode');
    return;
  }
  try {
    const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    let credential;
    if (serviceAccountStr) {
      credential = admin.credential.cert(JSON.parse(serviceAccountStr));
    } else if (serviceAccountPath) {
      credential = admin.credential.applicationDefault();
      process.env.GOOGLE_APPLICATION_CREDENTIALS = serviceAccountPath;
    } else {
      logger.info('[Firebase] No FIREBASE_SERVICE_ACCOUNT configured; running in bridge-only mode');
      return;
    }
    fbApp = admin.initializeApp({ credential, databaseURL: process.env.FIREBASE_DATABASE_URL });
    rtdb = fbApp.database();
    firestore = fbApp.firestore();
    isConnected = true;
    logger.info('[Firebase] Initialized successfully');
  } catch (err) {
    logger.warn(`[Firebase] Failed to initialize: ${err.message}`);
  }
}

function stopFirebaseSync() {
  if (fbApp) {
    fbApp.delete().catch(() => {});
    fbApp = null;
  }
  rtdb = null;
  firestore = null;
  isConnected = false;
  logger.info('[Firebase] Disconnected');
}

async function syncEvent(topic, payload) {
  if (!isConnected) return;
  const { _source, _fromKafka, _fromRedis, ...cleanPayload } = payload || {};
  const timestamp = Date.now();
  try {
    // Write to Realtime Database
    if (rtdb) {
      const rtdbRef = rtdb.ref(`events/${topic.replace(/\./g, '/')}/${timestamp}`);
      await rtdbRef.set({ ...cleanPayload, _syncedAt: timestamp });
      // Trim old events (keep last 100 per topic)
      const parentRef = rtdb.ref(`events/${topic.replace(/\./g, '/')}`);
      const snapshot = await parentRef.limitToFirst(-101).once('value');
      if (snapshot.numChildren() > 100) {
        const deletions = [];
        snapshot.forEach(child => deletions.push(child.ref.remove()));
        await Promise.all(deletions);
      }
    }
    // Write to Firestore
    if (firestore) {
      await firestore.collection(COLLECTION_NAME).add({
        topic,
        payload: cleanPayload,
        _syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      // Trim old documents (keep last 1000)
      const oldDocs = await firestore.collection(COLLECTION_NAME)
        .orderBy('_syncedAt', 'desc')
        .offset(1000)
        .limit(500)
        .get();
      if (!oldDocs.empty) {
        const batch = firestore.batch();
        oldDocs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }
    }
  } catch (err) {
    logger.warn(`[Firebase] Sync failed for ${topic}: ${err.message}`);
  }
}

module.exports = { startFirebaseSync, stopFirebaseSync, syncEvent };
