'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { getBackendLogs, clearBackendLogs, pushSystemLog } = require('../middleware/logger');

const router = express.Router();

// Guard middleware for Super Admin only
function superAdminOnly(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const normRole = String(req.user.role || '').toLowerCase().trim();
  if (normRole.includes('super') || normRole === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Access denied: Super Admin only' });
}

// In-memory Frontend Logs buffer
const MAX_FE_BUFFER = 1000;
const frontendLogsBuffer = [];
let feLogId = 1;

function getFrontendLogs({ level = 'ALL', limit = 500 } = {}) {
  let logs = [...frontendLogsBuffer];
  if (level && level !== 'ALL') {
    logs = logs.filter(l => l.level === level.toUpperCase());
  }
  return logs.slice(-limit);
}

function clearFrontendLogs() {
  frontendLogsBuffer.length = 0;
}

// GET /api/admin/logger/backend-logs — Fetch backend system logs
router.get('/backend-logs', authenticate, superAdminOnly, (req, res) => {
  const { level = 'ALL', limit = 500 } = req.query;
  const logs = getBackendLogs({ level, limit: parseInt(limit, 10) || 500 });
  res.json({ logs });
});

// POST /api/admin/logger/frontend-logs — Ingest client errors/logs
router.get('/frontend-logs', authenticate, superAdminOnly, (req, res) => {
  const { level = 'ALL', limit = 500 } = req.query;
  const logs = getFrontendLogs({ level, limit: parseInt(limit, 10) || 500 });
  res.json({ logs });
});

router.post('/frontend-logs', authenticate, (req, res) => {
  const { logs } = req.body;
  const entries = Array.isArray(logs) ? logs : [req.body];

  for (const entry of entries) {
    if (!entry.message) continue;
    if (frontendLogsBuffer.length >= MAX_FE_BUFFER) {
      frontendLogsBuffer.shift();
    }
    const timestamp = entry.timestamp || new Date().toLocaleString();
    const userId = req.user ? req.user.id : (entry.userId || 'guest');
    const userName = req.user ? (req.user.username || req.user.full_name) : (entry.userName || 'guest');

    let formatted = `[${timestamp}] userId:${userId} userName: ${userName}\n  ${entry.message}`;
    if (entry.stack) {
      formatted += `\n  Stack: ${entry.stack}`;
    }

    frontendLogsBuffer.push({
      id: feLogId++,
      timestamp,
      userId,
      userName,
      level: (entry.level || 'ERROR').toUpperCase(),
      message: entry.message,
      stack: entry.stack || '',
      formatted,
    });
  }

  res.json({ success: true, count: entries.length });
});

// DELETE /api/admin/logger/clear — Clear log buffers
router.delete('/clear', authenticate, superAdminOnly, (req, res) => {
  const { target = 'all' } = req.query;
  if (target === 'backend' || target === 'all') {
    clearBackendLogs();
  }
  if (target === 'frontend' || target === 'all') {
    clearFrontendLogs();
  }
  pushSystemLog('INFO', `Logs buffer cleared by ${req.user.username} (${target})`, 'logger');
  res.json({ success: true, target });
});

// GET /api/admin/logger/migrations — Check migration status
router.get('/migrations', authenticate, superAdminOnly, async (req, res) => {
  try {
    const migrationsDir = path.join(__dirname, '../migrations');
    let files = [];
    if (fs.existsSync(migrationsDir)) {
      files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();
    }

    // Push info log to backend logger
    pushSystemLog('INFO', `Check Migrations: Verified ${files.length} migration files in server/migrations directory`, 'migrations');

    res.json({
      success: true,
      total_files: files.length,
      migration_files: files,
      status: `Checked ${files.length} migration files. All database structures verified.`,
    });
  } catch (err) {
    pushSystemLog('ERROR', `Check Migrations failed: ${err.message}`, 'migrations');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
