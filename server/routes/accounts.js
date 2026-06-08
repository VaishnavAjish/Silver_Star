const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

const SYSTEM_CODES = ['1001','1002','1003','2001','2002','2003','2004','2005','3001','3002','4001','5001'];

// ─── helpers ──────────────────────────────────────────────────────────────────

async function accountUsage(client, id) {
  const checks = [
    ['je_lines',              'account_id'],
    ['payments',              'bank_account_id'],
    ['receipts',              'bank_account_id'],
    ['expenses',              'payment_account_id'],
    ['expense_categories',    'gl_account_id'],
    ['fixed_asset_categories','gl_asset_account_id'],
    ['fixed_asset_categories','gl_accum_depr_account_id'],
    ['fixed_asset_categories','gl_depr_expense_account_id'],
  ];
  for (const [table, col] of checks) {
    const r = await client.query(`SELECT 1 FROM ${table} WHERE ${col} = $1 LIMIT 1`, [id]);
    if (r.rows.length) return true;
  }
  return false;
}

// Recursively update path + level for all descendants after a parent move or code change
async function updateDescendantPaths(client, parentId, parentPath, parentLevel) {
  const children = await client.query(
    'SELECT id, code FROM accounts WHERE parent_id = $1', [parentId]
  );
  for (const child of children.rows) {
    const childPath  = parentPath + '/' + child.code;
    const childLevel = parentLevel + 1;
    await client.query(
      'UPDATE accounts SET path = $1, level = $2 WHERE id = $3',
      [childPath, childLevel, child.id]
    );
    await updateDescendantPaths(client, child.id, childPath, childLevel);
  }
}

// Walk up from targetId; returns true if sourceId appears in the ancestor chain
// Used to block circular parent assignments.
async function isDescendantOf(client, sourceId, targetId) {
  let cur = targetId;
  const seen = new Set();
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    if (cur === sourceId) return true;
    const r = await client.query('SELECT parent_id FROM accounts WHERE id = $1', [cur]);
    cur = r.rows[0]?.parent_id ? parseInt(r.rows[0].parent_id) : null;
  }
  return false;
}

// Shared balance CTE fragment
const BALANCE_CTE = `
  WITH ledger AS (
    SELECT jl.account_id,
           SUM(jl.debit)  AS total_debit,
           SUM(jl.credit) AS total_credit
    FROM   je_lines jl
    JOIN   journal_entries je ON je.id = jl.je_id
    WHERE  je.status = 'posted'
    GROUP  BY jl.account_id
  )`;

const BALANCE_EXPR = `
  CASE WHEN a.type IN ('asset','expense')
       THEN COALESCE(l.total_debit, 0) - COALESCE(l.total_credit, 0)
       ELSE COALESCE(l.total_credit, 0) - COALESCE(l.total_debit, 0)
  END AS balance`;

// ─── GET /api/accounts — flat list ───────────────────────────────────────────

router.get('/', authenticate, async (req, res) => {
  try {
    const { type, status, is_group, sub_type, q } = req.query;

    let query = `${BALANCE_CTE}
      SELECT a.id, a.code, a.name, a.type, a.sub_type, a.parent_id,
             a.is_group, a.is_posting, a.level, a.path, a.currency,
             ${BALANCE_EXPR},
             a.status, a.description, a.created_at, a.updated_at,
             p.name AS parent_name
      FROM   accounts a
      LEFT JOIN accounts p ON a.parent_id = p.id
      LEFT JOIN ledger l   ON l.account_id = a.id
      WHERE 1=1`;

    const params = [];
    if (type)              { params.push(type);            query += ` AND a.type = $${params.length}`; }
    if (status)            { params.push(status);          query += ` AND a.status = $${params.length}`; }
    if (is_group != null)  { params.push(is_group === 'true'); query += ` AND a.is_group = $${params.length}`; }
    if (sub_type)          { params.push(sub_type);        query += ` AND a.sub_type = $${params.length}`; }
    if (q?.trim()) {
      params.push(`%${q.trim()}%`);
      query += ` AND (LOWER(a.name) LIKE LOWER($${params.length}) OR LOWER(a.code) LIKE LOWER($${params.length}))`;
    }
    query += ' ORDER BY COALESCE(a.path, a.code), a.code';

    res.json((await pool.query(query, params)).rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/accounts/tree — nested hierarchy ───────────────────────────────
// MUST be defined before /:id to avoid Express matching 'tree' as an ID.

router.get('/tree', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`${BALANCE_CTE}
      SELECT a.id, a.code, a.name, a.type, a.sub_type, a.parent_id,
             a.is_group, a.is_posting, a.level, a.path, a.currency,
             ${BALANCE_EXPR},
             a.status, a.description
      FROM   accounts a
      LEFT JOIN ledger l ON l.account_id = a.id
      ORDER BY COALESCE(a.path, a.code), a.code`
    );

    // Build node map
    const byId = {};
    for (const row of result.rows) {
      byId[row.id] = { ...row, balance: parseFloat(row.balance) || 0, children: [] };
    }

    // Wire parent→child
    const roots = [];
    for (const row of result.rows) {
      const node = byId[row.id];
      if (row.parent_id && byId[row.parent_id]) {
        byId[row.parent_id].children.push(node);
      } else {
        roots.push(node);
      }
    }

    // Compute group totals (own balance + sum of all descendants)
    const calcTotal = (node) => {
      if (!node.children.length) return node.balance;
      const childSum = node.children.reduce((s, c) => s + calcTotal(c), 0);
      node.group_total = Math.round((node.balance + childSum) * 100) / 100;
      return node.group_total;
    };
    roots.forEach(calcTotal);

    res.json(roots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/accounts/search — typeahead ────────────────────────────────────

router.get('/search', authenticate, async (req, res) => {
  try {
    const { q = '', limit = 20, sub_types, exclude_sub_types } = req.query;

    let query = `SELECT id, code, name, type, sub_type
                 FROM   accounts
                 WHERE  status = 'active' AND is_group = false`;
    const params = [];

    if (q.trim()) {
      params.push(`%${q.trim()}%`);
      query += ` AND (LOWER(name) LIKE LOWER($${params.length}) OR LOWER(code) LIKE LOWER($${params.length}))`;
    }
    if (sub_types) {
      const types = sub_types.split(',').map(t => t.trim()).filter(Boolean);
      if (types.length) {
        query += ` AND sub_type IN (${types.map((_, i) => `$${params.length + i + 1}`).join(', ')})`;
        params.push(...types);
      }
    }
    if (exclude_sub_types) {
      const types = exclude_sub_types.split(',').map(t => t.trim()).filter(Boolean);
      if (types.length) {
        query += ` AND (sub_type IS NULL OR sub_type NOT IN (${types.map((_, i) => `$${params.length + i + 1}`).join(', ')}))`;
        params.push(...types);
      }
    }
    params.push(Math.min(parseInt(limit) || 20, 100));
    query += ` ORDER BY name LIMIT $${params.length}`;

    res.json((await pool.query(query, params)).rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/accounts/:id ────────────────────────────────────────────────────

router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`${BALANCE_CTE}
      SELECT a.id, a.code, a.name, a.type, a.sub_type, a.parent_id,
             a.is_group, a.is_posting, a.level, a.path, a.currency,
             ${BALANCE_EXPR},
             a.status, a.description, a.created_at, a.updated_at,
             p.name AS parent_name
      FROM   accounts a
      LEFT JOIN accounts p ON a.parent_id = p.id
      LEFT JOIN ledger l   ON l.account_id = a.id
      WHERE  a.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Account not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/accounts ───────────────────────────────────────────────────────

router.post('/', authenticate, authorize('admin'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    const { code, name, type, sub_type, parent_id, is_group, currency, description } = req.body;

    if (!code || !name || !type)
      { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Code, name, and type are required' }); }

    let level = 1;
    let path  = code;

    if (parent_id) {
      const pid     = parseInt(parent_id);
      const parentR = await client.query('SELECT * FROM accounts WHERE id = $1', [pid]);
      if (!parentR.rows[0])
        { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Parent account not found' }); }
      const parent = parentR.rows[0];
      if (!parent.is_group)
        { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Parent must be a group account' }); }
      if (parent.type !== type)
        { await client.query('ROLLBACK'); return res.status(400).json({ error: `Account type (${type}) must match parent type (${parent.type})` }); }

      level = (parent.level || 1) + 1;
      if (level > 4)
        { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Maximum hierarchy depth is 4 levels' }); }

      path = (parent.path || parent.code) + '/' + code;
    }

    const is_posting = !(is_group || false);

    const dup = await client.query(
      'SELECT id FROM accounts WHERE lower(code)=lower($1) OR lower(name)=lower($2) LIMIT 1',
      [code, name]
    );
    if (dup.rows.length)
      { await client.query('ROLLBACK'); return res.status(409).json({ error: 'Account code or name already exists' }); }

    const result = await client.query(
      `INSERT INTO accounts
         (code, name, type, sub_type, parent_id, is_group, is_posting, level, path, currency, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [code, name, type, sub_type || null, parent_id ? parseInt(parent_id) : null,
       is_group || false, is_posting, level, path, currency || 'INR', description || null]
    );

    await client.query('COMMIT');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ error: 'Account code already exists' });
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── PUT /api/accounts/:id ────────────────────────────────────────────────────

router.put('/:id', authenticate, authorize('admin', 'operator'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    const id = parseInt(req.params.id);
    const { code, name, type, sub_type, parent_id, is_group, currency, status, description } = req.body;

    const currentR = await client.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE', [id]);
    if (!currentR.rows.length) throw new Error('Account not found');
    const current = currentR.rows[0];

    // Transaction-safety checks
    const used = await accountUsage(client, id);
    if (used && code !== current.code)                   throw new Error('Cannot change code: account has transactions');
    if (used && type !== current.type)                   throw new Error('Cannot change type: account has transactions');
    if (used && Boolean(is_group) !== current.is_group)  throw new Error('Cannot change group flag: account has transactions');

    // Posting accounts cannot become group accounts if they have JE usage
    if (used && is_group)
      throw new Error('Cannot convert to group: account is used in journal entries');

    // Compute new level + path from (possibly changed) parent
    let newLevel = 1;
    let newPath  = code;

    if (parent_id) {
      const pid = parseInt(parent_id);
      if (pid === id) throw new Error('Account cannot be its own parent');

      // Circular reference: new parent must not be a descendant of this account
      if (await isDescendantOf(client, id, pid))
        throw new Error('Circular parent assignment: selected parent is a descendant of this account');

      const parentR = await client.query('SELECT * FROM accounts WHERE id=$1', [pid]);
      if (!parentR.rows.length)       throw new Error('Parent account not found');
      if (!parentR.rows[0].is_group)  throw new Error('Parent must be a group account');
      if (parentR.rows[0].type !== type)
        throw new Error(`Parent type (${parentR.rows[0].type}) must match account type (${type})`);

      newLevel = (parentR.rows[0].level || 1) + 1;
      if (newLevel > 4) throw new Error('Maximum hierarchy depth is 4 levels');
      newPath = (parentR.rows[0].path || parentR.rows[0].code) + '/' + code;
    }

    const dup = await client.query(
      'SELECT id FROM accounts WHERE id<>$1 AND (lower(code)=lower($2) OR lower(name)=lower($3)) LIMIT 1',
      [id, code, name]
    );
    if (dup.rows.length) throw new Error('Account code or name already exists');

    const is_posting = !(is_group || false);

    const result = await client.query(
      `UPDATE accounts
       SET code=$1, name=$2, type=$3, sub_type=$4, parent_id=$5, is_group=$6,
           is_posting=$7, level=$8, path=$9, currency=$10, status=$11, description=$12,
           updated_at=NOW()
       WHERE id=$13 RETURNING *`,
      [code, name, type, sub_type || null, parent_id ? parseInt(parent_id) : null,
       is_group || false, is_posting, newLevel, newPath,
       currency || 'INR', status || 'active', description || null, id]
    );

    // If parent or code changed, cascade path/level updates to all descendants
    const parentChanged = String(parent_id || null) !== String(current.parent_id || null);
    const codeChanged   = code !== current.code;
    if (parentChanged || codeChanged) {
      await updateDescendantPaths(client, id, newPath, newLevel);
    }

    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── DELETE /api/accounts/:id ─────────────────────────────────────────────────

router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    const accR = await client.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!accR.rows.length) throw new Error('Account not found');
    if (SYSTEM_CODES.includes(accR.rows[0].code))
      throw new Error('Cannot delete a system-mandatory account. Set it inactive instead.');
    const childR = await client.query('SELECT 1 FROM accounts WHERE parent_id=$1 LIMIT 1', [req.params.id]);
    if (childR.rows.length)
      throw new Error('Cannot delete an account with children. Remove children first or set inactive.');
    if (await accountUsage(client, req.params.id))
      throw new Error('Cannot delete an account with transactions. Set it inactive instead.');
    await client.query('DELETE FROM accounts WHERE id=$1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
