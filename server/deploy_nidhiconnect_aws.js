'use strict';

const fs = require('fs');
const path = require('path');

console.log('Writing NidhiConnect files...');

// 1. Migration File
const migrationSql = `-- Phase 76: NidhiConnect Controlled Lot Name Correction Schema

CREATE TABLE IF NOT EXISTS lot_series (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL DEFAULT 1,
  series_prefix VARCHAR(50) NOT NULL,
  next_number INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_lot_series_prefix UNIQUE (company_id, series_prefix)
);

CREATE TABLE IF NOT EXISTS import_batches (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL DEFAULT 1,
  batch_number VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_row_lots (
  id SERIAL PRIMARY KEY,
  company_id INT NOT NULL DEFAULT 1,
  batch_id INT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  lot_series_id INT NOT NULL REFERENCES lot_series(id),
  lot_name VARCHAR(100) NOT NULL,
  sequence_number VARCHAR(20) NOT NULL,
  row_version INT NOT NULL DEFAULT 1,
  b5_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  b5_reconciliation_status VARCHAR(30) DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_import_row_lot_name UNIQUE (company_id, lot_name),
  CONSTRAINT uq_import_row_lot_series_seq UNIQUE (lot_series_id, sequence_number)
);

CREATE TABLE IF NOT EXISTS import_row_lot_events (
  id SERIAL PRIMARY KEY,
  import_row_lot_id INT NOT NULL REFERENCES import_row_lots(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  old_lot_name VARCHAR(100) NOT NULL,
  new_lot_name VARCHAR(100) NOT NULL,
  old_lot_series_id INT,
  new_lot_series_id INT,
  reason TEXT NOT NULL,
  actor_id INT NOT NULL,
  request_id VARCHAR(100),
  row_version INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS import_batch_snapshots (
  id SERIAL PRIMARY KEY,
  batch_id INT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  snapshot_type VARCHAR(30) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

fs.writeFileSync(path.join(__dirname, 'migrations', 'phase76-nidhiconnect-lot-correction.sql'), migrationSql, 'utf8');

// 2. Service File
const serviceCode = `'use strict';

const pool = require('../db/pool');

function normalizeLotName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.trim().toUpperCase();
}

function extractSeriesPrefix(lotName) {
  const parts = lotName.split('-');
  if (parts.length <= 1) return lotName;
  parts.pop();
  return parts.join('-');
}

async function correctLotName({
  importRowLotId,
  newLotName,
  reason,
  actorId,
  requestId = null,
  expectedRowVersion = null,
  dbClient = null
}) {
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    const err = new Error('Correction reason is mandatory');
    err.statusCode = 400;
    err.code = 'REASON_REQUIRED';
    throw err;
  }

  const normalizedNewName = normalizeLotName(newLotName);
  if (!normalizedNewName) {
    const err = new Error('Invalid or empty new lot name');
    err.statusCode = 400;
    err.code = 'INVALID_LOT_NAME';
    throw err;
  }

  const client = dbClient || await pool.connect();
  const shouldRelease = !dbClient;

  try {
    if (shouldRelease) await client.query('BEGIN');

    const { rows: lotRows } = await client.query(
      \`SELECT r.*, b.status as batch_status, s.series_prefix
       FROM import_row_lots r
       JOIN import_batches b ON r.batch_id = b.id
       JOIN lot_series s ON r.lot_series_id = s.id
       WHERE r.id = \$1 FOR UPDATE OF r\`,
      [importRowLotId]
    );

    if (!lotRows.length) {
      const err = new Error(\`ImportRowLot with ID \${importRowLotId} not found\`);
      err.statusCode = 404;
      err.code = 'LOT_NOT_FOUND';
      throw err;
    }

    const lot = lotRows[0];
    const oldLotName = lot.lot_name;
    const oldSeriesId = lot.lot_series_id;
    const sequenceNumber = lot.sequence_number;
    const companyId = lot.company_id;

    if (oldLotName === normalizedNewName) {
      if (shouldRelease) await client.query('COMMIT');
      return lot;
    }

    if (expectedRowVersion !== null && expectedRowVersion !== undefined) {
      if (parseInt(lot.row_version) !== parseInt(expectedRowVersion)) {
        const err = new Error(\`Stale request. Current version is \${lot.row_version}, expected \${expectedRowVersion}\`);
        err.statusCode = 409;
        err.code = 'STALE_DATA_VERSION_MISMATCH';
        throw err;
      }
    }

    if (lot.batch_status === 'READY_FOR_FINAL_IMPORT') {
      const err = new Error('Batch is in READY_FOR_FINAL_IMPORT state. Reopen batch before correcting lot name.');
      err.statusCode = 400;
      err.code = 'BATCH_LOCKED_REQUIRE_REOPEN';
      throw err;
    }

    if (lot.b5_confirmed) {
      const err = new Error('Direct correction blocked after B5/Fantasy confirmation. Use external-reconciliation workflow.');
      err.statusCode = 422;
      err.code = 'DIRECT_CORRECTION_BLOCKED_B5_CONFIRMED';
      throw err;
    }

    const { rows: existingNameRows } = await client.query(
      \`SELECT id FROM import_row_lots WHERE company_id = \$1 AND lot_name = \$2 AND id != \$3\`,
      [companyId, normalizedNewName, importRowLotId]
    );

    if (existingNameRows.length > 0) {
      const err = new Error(\`Lot name '\${normalizedNewName}' already exists in company\`);
      err.statusCode = 409;
      err.code = 'DUPLICATE_LOT_NAME';
      throw err;
    }

    const newPrefix = extractSeriesPrefix(normalizedNewName);
    let newSeriesId = oldSeriesId;

    if (newPrefix !== lot.series_prefix) {
      let { rows: seriesRows } = await client.query(
        \`SELECT id, series_prefix, next_number FROM lot_series WHERE company_id = \$1 AND series_prefix = \$2\`,
        [companyId, newPrefix]
      );

      if (!seriesRows.length) {
        const { rows: createdSeries } = await client.query(
          \`INSERT INTO lot_series (company_id, series_prefix, next_number)
           VALUES (\$1, \$2, 1) RETURNING *\`,
          [companyId, newPrefix]
        );
        seriesRows = createdSeries;
      }

      newSeriesId = seriesRows[0].id;

      const { rows: seqConflictRows } = await client.query(
        \`SELECT id FROM import_row_lots WHERE lot_series_id = \$1 AND sequence_number = \$2 AND id != \$3\`,
        [newSeriesId, sequenceNumber, importRowLotId]
      );

      if (seqConflictRows.length > 0) {
        const err = new Error(\`Sequence number '\${sequenceNumber}' is already used in series '\${newPrefix}'\`);
        err.statusCode = 409;
        err.code = 'SERIES_SEQUENCE_CONFLICT';
        throw err;
      }
    }

    const newRowVersion = lot.row_version + 1;
    const { rows: [updatedLot] } = await client.query(
      \`UPDATE import_row_lots
       SET lot_name = \$1,
           lot_series_id = \$2,
           row_version = \$3,
           updated_at = NOW()
       WHERE id = \$4 AND row_version = \$5
       RETURNING *\`,
      [normalizedNewName, newSeriesId, newRowVersion, importRowLotId, lot.row_version]
    );

    if (!updatedLot) {
      const err = new Error('Concurrent update detected on lot record');
      err.statusCode = 409;
      err.code = 'STALE_DATA_VERSION_MISMATCH';
      throw err;
    }

    await client.query(
      \`INSERT INTO import_row_lot_events
         (import_row_lot_id, action, old_lot_name, new_lot_name, old_lot_series_id, new_lot_series_id, reason, actor_id, request_id, row_version)
       VALUES (\$1, 'LOT_NAME_CORRECTED', \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9)\`,
      [
        importRowLotId,
        oldLotName,
        normalizedNewName,
        oldSeriesId,
        newSeriesId,
        reason.trim(),
        actorId,
        requestId || null,
        newRowVersion
      ]
    );

    if (shouldRelease) await client.query('COMMIT');
    return updatedLot;
  } catch (err) {
    if (shouldRelease) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (shouldRelease) client.release();
  }
}

async function reopenBatch(batchId, actorId) {
  const { rows } = await pool.query(
    \`UPDATE import_batches
     SET status = 'REOPENED', updated_at = NOW()
     WHERE id = \$1 AND status = 'READY_FOR_FINAL_IMPORT'
     RETURNING *\`,
    [batchId]
  );
  if (!rows.length) {
    throw new Error('Batch not found or not in READY_FOR_FINAL_IMPORT status');
  }
  return rows[0];
}

async function createBatchSnapshot(batchId, snapshotType) {
  const { rows: lotRows } = await pool.query(
    \`SELECT id, lot_name, sequence_number, row_version, b5_confirmed
     FROM import_row_lots WHERE batch_id = \$1 ORDER BY id\`,
    [batchId]
  );

  const { rows: [snapshot] } = await pool.query(
    \`INSERT INTO import_batch_snapshots (batch_id, snapshot_type, payload)
     VALUES (\$1, \$2, \$3) RETURNING *\`,
    [batchId, snapshotType, JSON.stringify(lotRows)]
  );

  return snapshot;
}

module.exports = {
  normalizeLotName,
  extractSeriesPrefix,
  correctLotName,
  reopenBatch,
  createBatchSnapshot,
};
`;

fs.writeFileSync(path.join(__dirname, 'services', 'nidhiConnectService.js'), serviceCode, 'utf8');

// 3. Route File
const routeCode = `'use strict';

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { correctLotName, reopenBatch } = require('../services/nidhiConnectService');

router.post('/lots/:id/correct-name', authenticate, authorize('admin', 'super_admin', 'operator'), async (req, res) => {
  try {
    const importRowLotId = parseInt(req.params.id, 10);
    const { new_lot_name, reason, expected_row_version } = req.body;
    const requestId = req.headers['x-request-id'] || null;

    const updatedLot = await correctLotName({
      importRowLotId,
      newLotName: new_lot_name,
      reason,
      actorId: req.user ? req.user.id : 1,
      requestId,
      expectedRowVersion: expected_row_version !== undefined ? expected_row_version : null,
    });

    res.json({
      success: true,
      message: 'Lot name corrected successfully',
      lot: updatedLot,
    });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({
      error: err.message,
      code: err.code || 'CORRECT_LOT_NAME_ERROR',
    });
  }
});

router.post('/batches/:id/reopen', authenticate, authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const batchId = parseInt(req.params.id, 10);
    const batch = await reopenBatch(batchId, req.user ? req.user.id : 1);
    res.json({
      success: true,
      message: 'Batch reopened successfully',
      batch,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
`;

fs.writeFileSync(path.join(__dirname, 'routes', 'nidhiConnect.js'), routeCode, 'utf8');

// 4. Update app.js
let appJs = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
if (!appJs.includes('/api/nidhi-connect')) {
  appJs = appJs.replace(
    "const transferRoutes = require('./routes/transfers');",
    "const transferRoutes = require('./routes/transfers');\nconst nidhiConnectRoutes = require('./routes/nidhiConnect');"
  );
  appJs = appJs.replace(
    "app.use('/api/transfers', transferRoutes);",
    "app.use('/api/nidhi-connect', nidhiConnectRoutes);\napp.use('/api/transfers', transferRoutes);"
  );
  fs.writeFileSync(path.join(__dirname, 'app.js'), appJs, 'utf8');
  console.log('✔ app.js updated to include /api/nidhi-connect');
}

// 5. Execute DB Migration
require('dotenv').config();
const pool = require('./db/pool');
pool.query(migrationSql)
  .then(() => {
    console.log('✔ Phase 76 DB migration executed');
    process.exit(0);
  })
  .catch(err => {
    console.error('Migration error:', err.message);
    process.exit(1);
  });
