/**
 * ─── Master CRUD Factory (Hardened) ──────────────────────────────────────────
 *
 * Standard CRUD router for all lookup / master tables.
 * Every handler uses asyncWrap so errors reach the central errorHandler —
 * no try/catch needed inside routes.
 *
 * Improvements over v1:
 *  • asyncWrap — async errors never silently swallow
 *  • Parameterised LIMIT/OFFSET prevent injection via query string
 *  • Input length caps on 'search' to prevent regex-DoS
 *  • Bulk-upload CSV/XLSX endpoint with per-row error collection
 *  • Cache key includes all query dimensions (no stale data on filter change)
 */
'use strict';

const express  = require('express');
const multer   = require('multer');
const pool     = require('../db/pool');
const cache    = require('../db/cache');
const { authenticate, authorize } = require('../middleware/auth');
const { asyncWrap } = require('../middleware/errorHandler');
const { dispatchEvent } = require('../services/eventDispatcher');

const MASTER_TTL  = parseInt(process.env.MASTER_TTL || '60', 10);
const MAX_LIMIT   = 2000;    // safety cap — never let a client fetch millions of rows
const MAX_SEARCH  = 100;     // search string length cap

// Multer for CSV/XLSX bulk upload — memory storage, 5 MB max
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/** Coerce empty-string → null so PostgreSQL typed columns don't get '' */
function normalizeVal(v) {
  return v === '' ? null : v;
}

/** Safe integer clamp for LIMIT / OFFSET */
function safeInt(val, def, max) {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < 0) return def;
  return Math.min(n, max);
}

/** Validate a query parameter is a non-negative integer and cap it.
 *  Returns null when the value is malformed (NaN, negative) so callers can 400. */
function validateIntParam(val, max) {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(n, max);
}

function createMasterRouter(tableName, config = {}) {
  const router = express.Router();
  const {
    columns    = [],
    orderBy    = 'id',
    joins      = '',
    selectExtra = '',
    filterColumns = [],     // extra columns that can be filtered via query param
    searchFields = ['name', 'code'],
    alias: configAlias,
  } = config;

  const alias = configAlias || tableName.charAt(0);

  function listCacheKey(status, search, limit, offset, extraFilters) {
    const extra = extraFilters.map(([k, v]) => `${k}=${v}`).sort().join('_');
    return `master_${tableName}_${status || 'all'}_${(search || '').slice(0, MAX_SEARCH)}_${limit}_${offset}_${extra}`;
  }

  // ── GET / — paginated list (cached) ───────────────────────────────────────
  router.get('/', authenticate, asyncWrap(async (req, res) => {
    const { status, search } = req.query;
    const limit = req.query.limit !== undefined
      ? validateIntParam(req.query.limit, MAX_LIMIT)
      : 100;
    if (limit === null) return res.status(400).json({ error: 'Invalid `limit` — must be a non-negative integer' });
    const offset = req.query.offset !== undefined
      ? validateIntParam(req.query.offset, 1_000_000)
      : 0;
    if (offset === null) return res.status(400).json({ error: 'Invalid `offset` — must be a non-negative integer' });

    // Collect extra filter values from query params
    const extraFilters = filterColumns
      .filter(col => req.query[col] !== undefined && req.query[col] !== '')
      .map(col => [col, String(req.query[col]).slice(0, 50)]);

    // Clamp search length to prevent regex-DoS
    const safeSearch = search ? String(search).slice(0, MAX_SEARCH) : null;

    const data = await cache.get(
      listCacheKey(status, safeSearch, limit, offset, extraFilters),
      MASTER_TTL,
      async () => {
        const params = [];
        let where = 'WHERE 1=1';

        if (status) {
          params.push(status);
          where += ` AND ${alias}.status = $${params.length}`;
        }
        if (safeSearch) {
          params.push(`%${safeSearch}%`);
          const idx = params.length;
          where += ` AND (${searchFields.map(f => `${alias}.${f} ILIKE $${idx}`).join(' OR ')})`;
        }
        for (const [col, val] of extraFilters) {
          params.push(val);
          where += ` AND ${alias}.${col} = $${params.length}`;
        }

        const baseSelect = `SELECT ${alias}.*${selectExtra ? ', ' + selectExtra : ''}
                            FROM ${tableName} ${alias} ${joins} ${where}`;

        // Count (reuse same WHERE, no LIMIT/OFFSET)
        const countQ = `SELECT COUNT(${alias}.id) FROM ${tableName} ${alias} ${joins} ${where}`;
        const [countResult, rowsResult] = await Promise.all([
          pool.query(countQ, params),
          pool.query(
            `${baseSelect} ORDER BY ${alias}.${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, limit, offset]
          ),
        ]);

        return {
          data:  rowsResult.rows,
          total: parseInt(countResult.rows[0].count, 10),
        };
      }
    );

    res.json(data);
  }));

  // ── GET /:id — single record ───────────────────────────────────────────────
  router.get('/:id', authenticate, asyncWrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID.' });

    const result = await pool.query(
      `SELECT ${alias}.*${selectExtra ? ', ' + selectExtra : ''}
       FROM ${tableName} ${alias} ${joins}
       WHERE ${alias}.id = $1`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Record not found.' });
    res.json(result.rows[0]);
  }));

  // ── POST / — create ───────────────────────────────────────────────────────
  router.post('/', authenticate, authorize('admin', 'operator'), asyncWrap(async (req, res) => {
    const cols = columns.filter(c => req.body[c] !== undefined);
    if (cols.length === 0) return res.status(400).json({ error: 'No valid fields provided.' });

    const vals = cols.map(c => normalizeVal(req.body[c]));
    const placeholders = cols.map((_, i) => `$${i + 1}`);

    const result = await pool.query(
      `INSERT INTO ${tableName} (${cols.join(', ')})
       VALUES (${placeholders.join(', ')})
       RETURNING *`,
      vals
    );

    cache.invalidatePrefix(`master_${tableName}_`);
    dispatchEvent('master.created', { id: result.rows[0].id, tableName, module: 'masters' });
    res.status(201).json(result.rows[0]);
  }));

  // ── PUT /:id — update ─────────────────────────────────────────────────────
  router.put('/:id', authenticate, authorize('admin', 'operator'), asyncWrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID.' });

    const cols = columns.filter(c => req.body[c] !== undefined);
    if (cols.length === 0) return res.status(400).json({ error: 'No valid fields to update.' });

    const vals = cols.map(c => normalizeVal(req.body[c]));
    const setClause = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
    vals.push(id);

    const result = await pool.query(
      `UPDATE ${tableName} SET ${setClause}
       WHERE id = $${vals.length}
       RETURNING *`,
      vals
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Record not found.' });

    cache.invalidatePrefix(`master_${tableName}_`);
    dispatchEvent('master.updated', { id, tableName, module: 'masters' });
    res.json(result.rows[0]);
  }));

  // ── DELETE /:id ───────────────────────────────────────────────────────────
  router.delete('/:id', authenticate, authorize('admin'), asyncWrap(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid ID.' });

    const result = await pool.query(
      `DELETE FROM ${tableName} WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Record not found.' });

    cache.invalidatePrefix(`master_${tableName}_`);
    dispatchEvent('master.deleted', { id, tableName, module: 'masters' });
    res.json({ success: true, id: result.rows[0].id });
  }));

  // ── POST /bulk-upload — CSV/XLSX import ───────────────────────────────────
  router.post('/bulk-upload', authenticate, authorize('admin', 'operator'),
    upload.single('file'),
    asyncWrap(async (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

      const ext = (req.file.originalname || '').split('.').pop().toLowerCase();
      let rows = [];

      if (ext === 'csv') {
        // Simple CSV parser — no external dependency
        const text = req.file.buffer.toString('utf8');
        const lines = text.split(/\r?\n/).filter(Boolean);
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
        for (let i = 1; i < lines.length; i++) {
          const cells = lines[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
          const row = {};
          headers.forEach((h, j) => { row[h] = cells[j] || ''; });
          rows.push({ rowNum: i + 1, data: row });
        }
      } else if (ext === 'xlsx') {
        // XLSX — requires 'xlsx' package
        try {
          const XLSX = require('xlsx');
          const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
          rows = json.map((r, i) => ({
            rowNum: i + 2,
            data: Object.fromEntries(
              Object.entries(r).map(([k, v]) => [k.toLowerCase().trim(), v])
            ),
          }));
        } catch {
          return res.status(400).json({ error: 'XLSX parsing failed. Is the xlsx package installed?' });
        }
      } else {
        return res.status(400).json({ error: 'Only .csv and .xlsx files are supported.' });
      }

      // Insert rows in a single transaction; collect per-row errors
      let inserted = 0, skipped = 0;
      const errors = [];
      const client = await pool.primaryPool.connect();
      try {
        await client.query('BEGIN');
        for (const { rowNum, data } of rows) {
          const cols = columns.filter(c => data[c] !== undefined && data[c] !== '');
          if (cols.length === 0) { skipped++; continue; }
          const vals = cols.map(c => normalizeVal(data[c]));
          const ph   = cols.map((_, i) => `$${i + 1}`);
          try {
            await client.query(
              `INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${ph.join(', ')}) ON CONFLICT DO NOTHING`,
              vals
            );
            inserted++;
          } catch (e) {
            skipped++;
            errors.push({ row: rowNum, error: e.message });
            if (errors.length >= 50) break; // cap error list
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }

      cache.invalidatePrefix(`master_${tableName}_`);
      dispatchEvent('master.bulk_created', { tableName, total_rows: rows.length, inserted, skipped, module: 'masters' });
      res.json({ total_rows: rows.length, inserted, skipped, errors });
    })
  );

  return router;
}

module.exports = createMasterRouter;
