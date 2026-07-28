'use strict';

const fs = require('fs');
const path = require('path');

console.log('Writing NidhiConnect files (Backend + Frontend)...');

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
const pool = require('../db/pool');
const { correctLotName, reopenBatch } = require('../services/nidhiConnectService');

router.get('/lots', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      \`SELECT r.*, b.status as batch_status, s.series_prefix
       FROM import_row_lots r
       JOIN import_batches b ON r.batch_id = b.id
       JOIN lot_series s ON r.lot_series_id = s.id
       ORDER BY r.id DESC LIMIT 200\`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// 5. Frontend Files Sync
const feRoot = path.join(__dirname, '..', 'client', 'src', 'modules', 'inventory');

const modalCode = `import { useState, useEffect } from 'react';
import Modal from '../../../shared/components/Modal';
import { useApi } from '../../../shared/hooks/useApi';
import toast from 'react-hot-toast';
import { Edit3, AlertCircle, RefreshCw, Lock } from 'lucide-react';

export default function CorrectLotNameModal({ open, onClose, lot, onUpdated }) {
  const api = useApi();
  const [newLotName, setNewLotName] = useState('');
  const [reason, setReason]         = useState('');
  const [loading, setLoading]       = useState(false);
  const [reopening, setReopening]   = useState(false);
  const [batchStatus, setBatchStatus] = useState(lot?.batch_status || 'DRAFT');

  useEffect(() => {
    if (lot) {
      setNewLotName(lot.lot_name || '');
      setReason('');
      setBatchStatus(lot.batch_status || 'DRAFT');
    }
  }, [lot]);

  if (!lot) return null;

  const isReadyForImport = batchStatus === 'READY_FOR_FINAL_IMPORT';
  const isB5Confirmed = Boolean(lot.b5_confirmed);

  const handleReopenBatch = async () => {
    if (!lot.batch_id) return;
    setReopening(true);
    try {
      await api.post(\`/api/nidhi-connect/batches/\${lot.batch_id}/reopen\`);
      toast.success('Batch reopened successfully');
      setBatchStatus('REOPENED');
    } catch (err) {
      toast.error(err.message || 'Failed to reopen batch');
    } finally {
      setReopening(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) {
      return toast.error('A mandatory correction reason is required');
    }

    const trimmedNewName = newLotName.trim().toUpperCase();
    if (!trimmedNewName) {
      return toast.error('Please provide a valid new lot name');
    }

    if (trimmedNewName === lot.lot_name) {
      return toast.error('New lot name must be different from current lot name');
    }

    setLoading(true);
    try {
      const res = await api.post(\`/api/nidhi-connect/lots/\${lot.id}/correct-name\`, {
        new_lot_name: trimmedNewName,
        reason: reason.trim(),
        expected_row_version: lot.row_version,
      });

      toast.success(\`Lot name corrected to \${res.lot.lot_name}\`);
      if (onUpdated) onUpdated(res.lot);
      if (onClose) onClose();
    } catch (err) {
      if (err.status === 409) {
        toast.error(err.message || 'Version mismatch or duplicate lot name');
      } else {
        toast.error(err.message || 'Failed to correct lot name');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Correct Lot Name (NidhiConnect)"
      icon={<Edit3 size={16} style={{ color: 'var(--brand)', marginRight: 6 }} />}
      large
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading || isReadyForImport || isB5Confirmed}
          >
            {loading ? 'Correcting…' : 'Save Correction'}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {isB5Confirmed && (
          <div style={{ display: 'flex', gap: 8, padding: '10px 12px', background: '#FFEBEE', border: '1px solid #FFCDD2', borderRadius: 6, fontSize: 12, color: '#C62828' }}>
            <Lock size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <strong>B5 / External Reconciliation Lock:</strong>
              <p style={{ margin: '2px 0 0' }}>
                Direct correction is permanently blocked after B5/Fantasy confirmation. Please use the controlled external-reconciliation workflow.
              </p>
            </div>
          </div>
        )}

        {isReadyForImport && !isB5Confirmed && (
          <div style={{ display: 'flex', gap: 10, padding: '10px 12px', background: '#FFF3E0', border: '1px solid #FFE0B2', borderRadius: 6, fontSize: 12, color: '#E65100', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <strong>Batch Locked (READY_FOR_FINAL_IMPORT):</strong>
                <p style={{ margin: '2px 0 0' }}>
                  This batch is locked for import. Reopen the batch first to allow lot name corrections.
                </p>
              </div>
            </div>
            <button type="button" className="btn btn-sm" onClick={handleReopenBatch} disabled={reopening} style={{ flexShrink: 0, background: '#E65100', color: '#fff', border: 'none' }}>
              <RefreshCw size={12} className={reopening ? 'spin' : ''} /> {reopening ? 'Reopening…' : 'Reopen Batch'}
            </button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="fg">
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)' }}>Current Lot Name</label>
            <input type="text" value={lot.lot_name || ''} readOnly style={{ background: 'var(--g100)', color: 'var(--g700)', fontFamily: 'var(--mono)', fontWeight: 600 }} />
          </div>
          <div className="fg">
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)' }}>Sequence Number (Immutable)</label>
            <input type="text" value={lot.sequence_number || ''} readOnly style={{ background: 'var(--g100)', color: 'var(--g700)', fontFamily: 'var(--mono)' }} />
          </div>
        </div>

        <div className="fg">
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)' }}>
            New Lot Name <span style={{ color: '#C62828' }}>*</span>
          </label>
          <input type="text" value={newLotName} onChange={(e) => setNewLotName(e.target.value)} placeholder="e.g. SSD013-JUL26-040" disabled={isReadyForImport || isB5Confirmed} style={{ fontFamily: 'var(--mono)', fontWeight: 700 }} />
          <span style={{ fontSize: 10, color: 'var(--g500)', marginTop: 2 }}>
            Must be company-wide unique. Sequence number must match and series linkage will be updated automatically.
          </span>
        </div>

        <div className="fg">
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--g600)' }}>
            Mandatory Correction Reason <span style={{ color: '#C62828' }}>*</span>
          </label>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for name correction (e.g. month code registration error)..." disabled={isReadyForImport || isB5Confirmed} />
        </div>

        <div style={{ padding: 10, background: 'var(--g50)', borderRadius: 6, fontSize: 11, color: 'var(--g600)' }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Rules & Integrity Contract:</div>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            <li>ImportRowLot ID and sequence remain unchanged.</li>
            <li>Lot Series counter is <strong>not</strong> incremented or consumed.</li>
            <li>Old name is permanently retained in the append-only event ledger.</li>
          </ul>
        </div>
      </form>
    </Modal>
  );
}
`;

fs.mkdirSync(path.join(feRoot, 'components'), { recursive: true });
fs.writeFileSync(path.join(feRoot, 'components', 'CorrectLotNameModal.jsx'), modalCode, 'utf8');

const pageCode = `import { useState, useEffect, useMemo } from 'react';
import { useApi } from '../../../shared/hooks/useApi';
import CorrectLotNameModal from '../components/CorrectLotNameModal';
import { Edit3, Lock, Search, RefreshCw, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function NidhiConnectPage() {
  const api = useApi();
  const [lots, setLots]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [selectedLot, setSelectedLot] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const fetchLots = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/nidhi-connect/lots').catch(() => ({ data: [] }));
      setLots(res.data || []);
    } catch (err) {
      toast.error('Failed to load import lots');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLots();
  }, []);

  const handleCorrectName = (lot) => {
    setSelectedLot(lot);
    setShowModal(true);
  };

  const handleUpdated = (updatedLot) => {
    setLots(prev => prev.map(l => l.id === updatedLot.id ? { ...l, ...updatedLot } : l));
    fetchLots();
  };

  const filteredLots = useMemo(() => {
    if (!search.trim()) return lots;
    const s = search.toLowerCase();
    return lots.filter(l =>
      l.lot_name?.toLowerCase().includes(s) ||
      l.sequence_number?.toLowerCase().includes(s)
    );
  }, [lots, search]);

  return (
    <div className="animate-in" style={{ padding: 16, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--brand-dark)' }}>
            NidhiConnect — Import Lot Management
          </h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--g600)' }}>
            Controlled Lot Name Correction, Batch Reopening, and Lineage Audit Ledger.
          </p>
        </div>
        <button className="btn" onClick={fetchLots} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
        </button>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center' }}>
        <div style={{ position: 'relative', width: 260 }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: 'var(--g400)' }} />
          <input
            type="text"
            placeholder="Search lot name or sequence..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 30, height: 34, width: '100%', borderRadius: 6, border: '1px solid var(--g300)' }}
          />
        </div>
        <span style={{ fontSize: 12, color: 'var(--g600)' }}>{filteredLots.length} lots</span>
      </div>

      <div className="grid-wrap" style={{ flex: 1, overflow: 'auto', background: '#fff', border: '1px solid var(--g200)', borderRadius: 8 }}>
        {loading ? (
          <div className="empty-state" style={{ padding: 60 }}><div className="spinner" /></div>
        ) : filteredLots.length === 0 ? (
          <div className="empty-state" style={{ padding: 60, textAlign: 'center', color: 'var(--g500)' }}>
            <AlertCircle size={32} style={{ marginBottom: 8, color: 'var(--g400)' }} />
            <div>No import row lots found.</div>
          </div>
        ) : (
          <table className="dgrid">
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th>Lot Name</th>
                <th style={{ width: 100 }}>Sequence</th>
                <th style={{ width: 90 }}>Version</th>
                <th style={{ width: 140 }}>Batch Status</th>
                <th style={{ width: 120 }}>B5 Status</th>
                <th style={{ width: 110 }} className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredLots.map((l) => (
                <tr key={l.id}>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>#{l.id}</td>
                  <td>
                    <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--g900)' }}>
                      {l.lot_name}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{l.sequence_number}</td>
                  <td style={{ fontSize: 11 }}>v{l.row_version}</td>
                  <td>
                    <span className={\`badge \${l.batch_status === 'READY_FOR_FINAL_IMPORT' ? 'b-warn' : 'b-stock'}\`} style={{ fontSize: 10 }}>
                      {l.batch_status || 'DRAFT'}
                    </span>
                  </td>
                  <td>
                    {l.b5_confirmed ? (
                      <span className="badge b-danger" style={{ fontSize: 10, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Lock size={10} /> Confirmed
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: 'var(--g500)' }}>—</span>
                    )}
                  </td>
                  <td className="num">
                    <button className="btn btn-sm" onClick={() => handleCorrectName(l)} style={{ fontSize: 11, padding: '3px 8px' }}>
                      <Edit3 size={12} /> Correct
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CorrectLotNameModal
        open={showModal}
        onClose={() => setShowModal(false)}
        lot={selectedLot}
        onUpdated={handleUpdated}
      />
    </div>
  );
}
`;

fs.mkdirSync(path.join(feRoot, 'pages'), { recursive: true });
fs.writeFileSync(path.join(feRoot, 'pages', 'NidhiConnectPage.jsx'), pageCode, 'utf8');

// Update routes.js
let routesJs = fs.readFileSync(path.join(feRoot, 'routes.js'), 'utf8');
if (!routesJs.includes('NidhiConnectPage')) {
  routesJs = routesJs.replace(
    "const NewTransferPage      = lazy(() => import('./pages/NewTransferPage'));",
    "const NewTransferPage      = lazy(() => import('./pages/NewTransferPage'));\nconst NidhiConnectPage     = lazy(() => import('./pages/NidhiConnectPage'));"
  );
  routesJs = routesJs.replace(
    "{ path: 'inventory/closing',                   Component: InventoryClosingPage },",
    "{ path: 'inventory/closing',                   Component: InventoryClosingPage },\n  { path: 'inventory/nidhi-connect',             Component: NidhiConnectPage },"
  );
  fs.writeFileSync(path.join(feRoot, 'routes.js'), routesJs, 'utf8');
  console.log('✔ inventory/routes.js updated to include NidhiConnectPage');
}

// 6. DB Migration Execution
require('dotenv').config();
const pool = require('./db/pool');
pool.query(migrationSql)
  .then(() => {
    console.log('✔ Phase 76 DB migration complete');
    process.exit(0);
  })
  .catch(err => {
    console.error('Migration error:', err.message);
    process.exit(1);
  });
