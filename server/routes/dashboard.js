'use strict';

const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { query, primaryPool } = require('../db/pool');
const cache = require('../db/cache');
const { addJob } = require('../services/queueService');
const { logger } = require('../middleware/logger');
const { dispatchEvent } = require('../services/eventDispatcher');
const { getInventoryValuation, round2 } = require('../services/inventoryAccounting');

const CACHE_TTL = parseInt(process.env.DASHBOARD_TTL) || 30;

// ── Dashboard config table init (idempotent) ──────────────────────────
primaryPool.query(`
  CREATE TABLE IF NOT EXISTS user_dashboard_widgets (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    widget_key TEXT    NOT NULL,
    position   INTEGER DEFAULT 0,
    is_visible BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, widget_key)
  )
`).then(async () => {
  try {
    await primaryPool.query(`
      DELETE FROM user_dashboard_widgets a
      USING user_dashboard_widgets b
      WHERE a.id < b.id
        AND a.user_id = b.user_id
        AND a.widget_key = b.widget_key
    `);
  } catch (e) { /* ignore */ }
  try {
    await primaryPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'user_dashboard_widgets_user_id_widget_key_key'
            AND conrelid = 'user_dashboard_widgets'::regclass
        ) THEN
          ALTER TABLE user_dashboard_widgets
            ADD CONSTRAINT user_dashboard_widgets_user_id_widget_key_key
            UNIQUE (user_id, widget_key);
        END IF;
      END$$;
    `);
  } catch (e) { /* ignore */ }
  try {
    await primaryPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'fk_udw_user_id'
            AND conrelid = 'user_dashboard_widgets'::regclass
        ) THEN
          ALTER TABLE user_dashboard_widgets
            ADD CONSTRAINT fk_udw_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
        END IF;
      END$$;
    `);
  } catch (e) { /* ignore */ }
}).catch(err => logger.error('[dashboard] Table init error:', err.message));

const DEFAULT_WIDGETS = [
  { widget_key: 'profit_loss_summary', position: 0, is_visible: true },
  { widget_key: 'bank_balance',        position: 1, is_visible: true },
  { widget_key: 'sales_trend',         position: 2, is_visible: true },
  { widget_key: 'expenses_chart',      position: 3, is_visible: true },
  { widget_key: 'cash_flow_chart',     position: 4, is_visible: true },
  { widget_key: 'accounts_receivable', position: 5, is_visible: true },
  { widget_key: 'accounts_payable',    position: 6, is_visible: true },
  { widget_key: 'top_expenses',        position: 7, is_visible: true },
];

// ─── GET /api/dashboard — widget config ────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const cacheKey = `dashboard_config_${req.user.id}`;
    const widgets  = await cache.get(cacheKey, 60, async () => {
      const { rows } = await query(
        `SELECT widget_key, position, is_visible
         FROM   user_dashboard_widgets
         WHERE  user_id = $1
         ORDER  BY position`,
        [req.user.id]
      );
      if (rows.length === 0) return DEFAULT_WIDGETS;
      const existingKeys = new Set(rows.map(r => r.widget_key));
      const maxPos       = rows.reduce((m, r) => Math.max(m, r.position), -1);
      const newWidgets   = DEFAULT_WIDGETS
        .filter(w => !existingKeys.has(w.widget_key))
        .map((w, i) => ({ ...w, position: maxPos + 1 + i }));
      return [...rows, ...newWidgets];
    });
    res.json({ widgets });
  } catch (err) {
    logger.error('[dashboard] GET config error:', err.message);
    res.json({ widgets: DEFAULT_WIDGETS });
  }
});

// ─── POST /api/dashboard — save widget config ──────────────────────────
router.post('/', authenticate, async (req, res) => {
  const { widgets } = req.body;
  if (!Array.isArray(widgets)) return res.status(400).json({ error: 'widgets must be an array' });
  const client = await primaryPool.connect();
  try {
    await client.query('BEGIN');
    for (const w of widgets) {
      await client.query(
        `INSERT INTO user_dashboard_widgets (user_id, widget_key, position, is_visible)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, widget_key)
         DO UPDATE SET position = EXCLUDED.position, is_visible = EXCLUDED.is_visible`,
        [req.user.id, w.widget_key, w.position ?? 0, w.is_visible ?? true]
      );
    }
    await client.query('COMMIT');
    cache.invalidate(`dashboard_config_${req.user.id}`);
    dispatchEvent('dashboard.widget.updated', { user_id: req.user.id, module: 'dashboard' });
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('[dashboard] POST save error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────
function fyStart() {
  const now  = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-04-01`;
}
function fyLabel() {
  const now  = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `FY ${year}–${String(year + 1).slice(-2)}`;
}
function sixMonthsStart() {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 5);
  return d.toISOString().slice(0, 10);
}

// ─── Widget data resolvers (ported from v1.4) ──────────────────────────
async function resolveWidget(key) {
  const cacheKey = `dashboard_widget_${key}_${new Date().toISOString().split('T')[0]}`;
  switch (key) {
    case 'profit_loss_summary': {
      return cache.get(cacheKey, CACHE_TTL, async () => {
        const from_date = fyStart();
        const to_date = new Date().toISOString().split('T')[0];

        const [ledgerR, purchasesR, closingInventory] = await Promise.all([
          query(`
            WITH ledger AS (
              SELECT jl.account_id, SUM(jl.debit) AS total_debit, SUM(jl.credit) AS total_credit
              FROM je_lines jl
              JOIN journal_entries je ON je.id = jl.je_id
              WHERE je.status = 'posted' AND je.date BETWEEN $1 AND $2
              GROUP BY jl.account_id
            )
            SELECT a.id, a.code, a.type,
                   COALESCE(l.total_credit, 0) as total_credit,
                   COALESCE(l.total_debit, 0) as total_debit
            FROM accounts a LEFT JOIN ledger l ON l.account_id = a.id
            WHERE a.type IN ('revenue', 'expense') AND a.is_group = false
          `, [from_date, to_date]),
          query(
            `SELECT COALESCE(SUM(pnl.amount), 0) AS value
             FROM purchase_note_lines pnl
             JOIN purchase_notes pn ON pn.id = pnl.purchase_note_id
             WHERE pn.status != 'cancelled'
               AND pn.doc_date BETWEEN $1 AND $2
               AND COALESCE(pnl.is_capital, false) = false`,
            [from_date, to_date]
          ),
          getInventoryValuation(to_date)
        ]);

        let openingStock = 0;
        try {
          const openingR = await query(
            `SELECT COALESCE(SUM(value), 0) AS value FROM inventory_opening WHERE as_of_date < $1`,
            [from_date]
          );
          openingStock = round2(openingR.rows[0].value);
        } catch (e) { /* ignore */ }

        const revenueList = ledgerR.rows
          .filter(r => r.type === 'revenue')
          .map(r => ({ ...r, amount: parseFloat(r.total_credit) - parseFloat(r.total_debit) }));

        const expensesList = ledgerR.rows
          .filter(r => r.type === 'expense')
          .map(r => ({ ...r, amount: parseFloat(r.total_debit) - parseFloat(r.total_credit) }));

        const totalRevenue = revenueList.reduce((s, r) => s + r.amount, 0);

        const purchases = round2(purchasesR.rows[0].value);
        const closingStock = round2(closingInventory.value);
        const formulaCogs = round2(openingStock + purchases - closingStock);

        const cogsAccounts = ['5001', '5002', '5003'];
        const opexList = expensesList.filter(e => !cogsAccounts.includes(e.code));
        
        const totalOpex = opexList.reduce((s, r) => s + r.amount, 0);
        const grossProfit = totalRevenue - formulaCogs;
        const netProfit = grossProfit - totalOpex;

        logger.info(`[Dashboard P&L] period=${from_date}..${to_date} revenue=${totalRevenue} cogs=${formulaCogs} opex=${totalOpex} gross=${grossProfit} net=${netProfit}`);

        return { revenue: totalRevenue, expenses: totalOpex, profit: netProfit, period: fyLabel() };
      });
    }
    case 'expenses_chart': {
      return cache.get(cacheKey, CACHE_TTL, async () => {
        const from_date = fyStart();
        const to_date = new Date().toISOString().split('T')[0];
        const { rows } = await query(`
          SELECT a.name,
                 ROUND(SUM(jl.debit - jl.credit)::numeric, 2) AS amount
          FROM   je_lines jl
          JOIN   journal_entries je ON je.id = jl.je_id
          JOIN   accounts        a  ON a.id  = jl.account_id
          WHERE  a.type = 'expense' AND a.is_group = false
            AND  je.status = 'posted' AND je.date BETWEEN $1 AND $2
          GROUP  BY a.id, a.name
          HAVING SUM(jl.debit - jl.credit) > 0
          ORDER  BY amount DESC
          LIMIT  8
        `, [from_date, to_date]);
        return rows.map(r => ({ name: r.name, amount: parseFloat(r.amount) }));
      });
    }
    case 'sales_trend': {
      return cache.get(cacheKey, CACHE_TTL, async () => {
        const from_date = sixMonthsStart();
        const to_date = new Date().toISOString().split('T')[0];
        const { rows } = await query(`
          SELECT TO_CHAR(DATE_TRUNC('month', je.date), 'Mon ''YY') AS month,
                 DATE_TRUNC('month', je.date)                       AS month_ts,
                 ROUND(COALESCE(SUM(jl.credit - jl.debit),0)::numeric,2) AS amount
          FROM   je_lines jl
          JOIN   journal_entries je ON je.id = jl.je_id
          JOIN   accounts        a  ON a.id  = jl.account_id
          WHERE  a.type = 'revenue' AND a.is_group = false
            AND  je.status = 'posted' AND je.date BETWEEN $1 AND $2
          GROUP  BY DATE_TRUNC('month', je.date)
          ORDER  BY month_ts
        `, [from_date, to_date]);
        return rows.map(r => ({ month: r.month, amount: parseFloat(r.amount) }));
      });
    }
    case 'cash_flow_chart': {
      return cache.get(cacheKey, CACHE_TTL, async () => {
        const from_date = sixMonthsStart();
        const to_date = new Date().toISOString().split('T')[0];
        const { rows } = await query(`
          SELECT TO_CHAR(DATE_TRUNC('month', je.date), 'Mon ''YY') AS month,
                 DATE_TRUNC('month', je.date) AS month_ts,
                 ROUND(COALESCE(SUM(CASE WHEN a.type='revenue' THEN jl.credit - jl.debit ELSE 0 END),0)::numeric,2) AS inflow,
                 ROUND(COALESCE(SUM(CASE WHEN a.type='expense' THEN jl.debit - jl.credit ELSE 0 END),0)::numeric,2) AS outflow
          FROM   je_lines jl
          JOIN   journal_entries je ON je.id = jl.je_id
          JOIN   accounts        a  ON a.id  = jl.account_id
          WHERE  a.type IN ('revenue','expense') AND a.is_group = false
            AND  je.status = 'posted' AND je.date BETWEEN $1 AND $2
          GROUP  BY DATE_TRUNC('month', je.date)
          ORDER  BY month_ts
        `, [from_date, to_date]);
        return rows.map(r => ({ month: r.month, inflow: parseFloat(r.inflow), outflow: parseFloat(r.outflow) }));
      });
    }
    case 'bank_balance': {
      return cache.get(cacheKey, CACHE_TTL, async () => {
        const { rows } = await query(`
          SELECT a.code, a.name,
                 ROUND((COALESCE(SUM(jl.debit),0) - COALESCE(SUM(jl.credit),0))::numeric, 2) AS balance
          FROM   accounts a
          LEFT   JOIN je_lines        jl ON jl.account_id = a.id
          LEFT   JOIN journal_entries je ON je.id = jl.je_id AND je.status = 'posted'
          WHERE  a.is_group = false
            AND  a.type = 'asset'
            AND  (a.name ILIKE '%bank%'
                  OR a.name ILIKE '%cash%'
                  OR a.code ILIKE 'bank%'
                  OR a.code ILIKE 'cash%'
                  OR a.sub_type ILIKE 'bank'
                  OR a.sub_type ILIKE 'cash')
          GROUP  BY a.id, a.code, a.name
          ORDER  BY a.code
          LIMIT  10
        `);
        return rows.map(r => ({ code: r.code, name: r.name, balance: parseFloat(r.balance) }));
      });
    }
    case 'accounts_receivable': {
      return cache.get(cacheKey, CACHE_TTL, async () => {
        const { rows } = await query(`
          SELECT ROUND(COALESCE(SUM(jl.debit - jl.credit),0)::numeric, 2) AS total,
                 COUNT(DISTINCT a.id) AS acct_count
          FROM   accounts a
          LEFT   JOIN je_lines        jl ON jl.account_id = a.id
          LEFT   JOIN journal_entries je ON je.id = jl.je_id AND je.status = 'posted'
          WHERE  a.is_group = false
            AND  a.type = 'asset'
            AND  (a.name ILIKE '%receivable%'
                  OR a.name ILIKE '%debtor%'
                  OR a.sub_type ILIKE 'receivable')
        `);
        return { total: parseFloat(rows[0]?.total) || 0, acct_count: parseInt(rows[0]?.acct_count) || 0 };
      });
    }
    case 'accounts_payable': {
      return cache.get(cacheKey, CACHE_TTL, async () => {
        const { rows } = await query(`
          SELECT ROUND(COALESCE(SUM(jl.credit - jl.debit),0)::numeric, 2) AS total,
                 COUNT(DISTINCT a.id) AS acct_count
          FROM   accounts a
          LEFT   JOIN je_lines        jl ON jl.account_id = a.id
          LEFT   JOIN journal_entries je ON je.id = jl.je_id AND je.status = 'posted'
          WHERE  a.is_group = false
            AND  a.type = 'liability'
            AND  (a.name ILIKE '%payable%'
                  OR a.name ILIKE '%creditor%'
                  OR a.sub_type ILIKE 'payable')
        `);
        return { total: parseFloat(rows[0]?.total) || 0, acct_count: parseInt(rows[0]?.acct_count) || 0 };
      });
    }
    case 'top_expenses': {
      return cache.get(cacheKey, CACHE_TTL, async () => {
        const from_date = fyStart();
        const to_date = new Date().toISOString().split('T')[0];
        const { rows } = await query(`
          SELECT a.name,
                 ROUND(SUM(jl.debit - jl.credit)::numeric, 2) AS amount
          FROM   je_lines jl
          JOIN   journal_entries je ON je.id = jl.je_id
          JOIN   accounts        a  ON a.id  = jl.account_id
          WHERE  a.type = 'expense' AND a.is_group = false
            AND  je.status = 'posted' AND je.date BETWEEN $1 AND $2
          GROUP  BY a.id, a.name
          HAVING SUM(jl.debit - jl.credit) > 0
          ORDER  BY amount DESC
          LIMIT  6
        `, [from_date, to_date]);
        return rows.map(r => ({ name: r.name, amount: parseFloat(r.amount) }));
      });
    }
    default:
      return null;
  }
}

// ─── GET /api/dashboard/widget/:key — resolve single widget data ──────
router.get('/widget/:key', authenticate, async (req, res) => {
  try {
    const data = await resolveWidget(req.params.key);
    if (data === null) return res.status(404).json({ error: 'Unknown widget key' });
    if (req.params.key === 'profit_loss_summary') {
      logger.info(`[Dashboard Widget] profit_loss_summary: revenue=${data.revenue} expenses=${data.expenses} profit=${data.profit} period=${data.period}`);
    }
    res.json({ key: req.params.key, data });
  } catch (err) {
    logger.error(`[dashboard] widget/${req.params.key} error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Widget resolvers using materialized view with fallback
const WIDGETS = {
  revenue: async () => {
    try {
      const result = await query(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM mv_dashboard_financial
        WHERE account_type = 'revenue'
          AND month >= date_trunc('month', NOW() - INTERVAL '12 months')
      `, [], { readOnly: true });
      return { total: parseFloat(result.rows[0]?.total || 0) };
    } catch {
      const result = await query(`
        SELECT COALESCE(SUM(jl.credit - jl.debit), 0) as total
        FROM je_lines jl
        JOIN journal_entries je ON je.id = jl.je_id
        JOIN accounts a ON a.id = jl.account_id
        WHERE je.date >= date_trunc('month', NOW() - INTERVAL '12 months')
          AND je.status = 'posted'
          AND a.type = 'revenue'
      `, [], { readOnly: true });
      return { total: parseFloat(result.rows[0]?.total || 0) };
    }
  },

  expenses: async () => {
    try {
      const result = await query(`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM mv_dashboard_financial
        WHERE account_type = 'expense'
          AND month >= date_trunc('month', NOW() - INTERVAL '12 months')
      `, [], { readOnly: true });
      return { total: parseFloat(result.rows[0]?.total || 0) };
    } catch {
      const result = await query(`
        SELECT COALESCE(SUM(jl.debit - jl.credit), 0) as total
        FROM je_lines jl
        JOIN journal_entries je ON je.id = jl.je_id
        JOIN accounts a ON a.id = jl.account_id
        WHERE je.date >= date_trunc('month', NOW() - INTERVAL '12 months')
          AND je.status = 'posted'
          AND a.type = 'expense'
      `, [], { readOnly: true });
      return { total: parseFloat(result.rows[0]?.total || 0) };
    }
  },

  profit: async () => {
    try {
      const result = await query(`
        SELECT account_type, COALESCE(SUM(amount), 0) as total
        FROM mv_dashboard_financial
        WHERE account_type IN ('revenue', 'expense')
          AND month >= date_trunc('month', NOW() - INTERVAL '12 months')
        GROUP BY account_type
      `, [], { readOnly: true });
      const revenue = parseFloat(result.rows.find(r => r.account_type === 'revenue')?.total || 0);
      const expenses = parseFloat(result.rows.find(r => r.account_type === 'expense')?.total || 0);
      return { profit: revenue - expenses, revenue, expenses };
    } catch {
      const result = await query(`
        SELECT a.type,
               COALESCE(SUM(CASE WHEN a.type = 'revenue' THEN jl.credit - jl.debit
                            ELSE jl.debit - jl.credit END), 0) as total
        FROM je_lines jl
        JOIN journal_entries je ON je.id = jl.je_id
        JOIN accounts a ON a.id = jl.account_id
        WHERE je.date >= date_trunc('month', NOW() - INTERVAL '12 months')
          AND je.status = 'posted'
          AND a.type IN ('revenue', 'expense')
        GROUP BY a.type
      `, [], { readOnly: true });
      const revenue = parseFloat(result.rows.find(r => r.type === 'revenue')?.total || 0);
      const expenses = parseFloat(result.rows.find(r => r.type === 'expense')?.total || 0);
      return { profit: revenue - expenses, revenue, expenses };
    }
  },

  apAging: async () => {
    const result = await query(`
      SELECT
        COUNT(*) FILTER (WHERE age(NOW(), due_date) < '0 days') as current_count,
        COALESCE(SUM(balance_due) FILTER (WHERE age(NOW(), due_date) < '0 days'), 0) as current_amount,
        COUNT(*) FILTER (WHERE age(NOW(), due_date) BETWEEN '0 days' AND '30 days') as overdue_30_count,
        COALESCE(SUM(balance_due) FILTER (WHERE age(NOW(), due_date) BETWEEN '0 days' AND '30 days'), 0) as overdue_30_amount,
        COUNT(*) FILTER (WHERE age(NOW(), due_date) BETWEEN '31 days' AND '60 days') as overdue_60_count,
        COALESCE(SUM(balance_due) FILTER (WHERE age(NOW(), due_date) BETWEEN '31 days' AND '60 days'), 0) as overdue_60_amount,
        COUNT(*) FILTER (WHERE age(NOW(), due_date) > '60 days') as overdue_90_count,
        COALESCE(SUM(balance_due) FILTER (WHERE age(NOW(), due_date) > '60 days'), 0) as overdue_90_amount
      FROM purchase_notes
      WHERE status IN ('open', 'partially_received')
        AND balance_due > 0
    `, [], { readOnly: true });
    return result.rows[0];
  },

  inventorySummary: async () => {
    const result = await query(`
      SELECT
        COUNT(*) as total_lots,
        COALESCE(SUM(quantity_on_hand), 0) as total_quantity,
        COALESCE(SUM(quantity_on_hand * avg_cost), 0) as total_value,
        COUNT(*) FILTER (WHERE status = 'CONSUMED') as consumed_lots,
        COUNT(*) FILTER (WHERE quantity_on_hand <= 0) as zero_stock_lots
      FROM inventory
      WHERE status NOT IN ('CONSUMED', 'SOLD', 'LOST', 'SCRAPPED')
    `, [], { readOnly: true });
    return result.rows[0];
  },

  monthlyTrend: async () => {
    try {
      const result = await query(`
        SELECT month,
               COALESCE(SUM(amount) FILTER (WHERE account_type = 'revenue'), 0) as revenue,
               COALESCE(SUM(amount) FILTER (WHERE account_type = 'expense'), 0) as expenses
        FROM mv_dashboard_financial
        WHERE month >= date_trunc('month', NOW() - INTERVAL '6 months')
        GROUP BY month
        ORDER BY month
      `, [], { readOnly: true });
      return result.rows;
    } catch {
      const result = await query(`
        SELECT date_trunc('month', je.date) as month,
               COALESCE(SUM(jl.credit - jl.debit) FILTER (WHERE a.type = 'revenue'), 0) as revenue,
               COALESCE(SUM(jl.debit - jl.credit) FILTER (WHERE a.type = 'expense'), 0) as expenses
        FROM je_lines jl
        JOIN journal_entries je ON je.id = jl.je_id
        JOIN accounts a ON a.id = jl.account_id
        WHERE je.date >= date_trunc('month', NOW() - INTERVAL '6 months')
          AND je.status = 'posted'
        GROUP BY date_trunc('month', je.date)
        ORDER BY month
      `, [], { readOnly: true });
      return result.rows;
    }
  },

  recentTransactions: async () => {
    const result = await query(`
      SELECT je.id, je.date, je.reference_no, je.description,
             je.status, je.created_at
      FROM journal_entries je
      ORDER BY je.created_at DESC
      LIMIT 10
    `, [], { readOnly: true });
    return result.rows;
  },

  cashFlow: async () => {
    const result = await query(`
      SELECT
        COALESCE(SUM(CASE WHEN a.type = 'revenue' THEN jl.credit - jl.debit ELSE 0 END), 0) as inflow,
        COALESCE(SUM(CASE WHEN a.type = 'expense' THEN jl.debit - jl.credit ELSE 0 END), 0) as outflow
      FROM je_lines jl
      JOIN journal_entries je ON je.id = jl.je_id
      JOIN accounts a ON a.id = jl.account_id
      WHERE je.date >= date_trunc('month', NOW())
        AND je.status = 'posted'
    `, [], { readOnly: true });
    return result.rows[0];
  },
};

// GET /api/dashboard/widgets — resolve all widgets
router.get('/widgets', authenticate, async (req, res) => {
  try {
    const now = Date.now();
    const results = {};

    await Promise.all(Object.entries(WIDGETS).map(async ([key, resolver]) => {
      try {
        results[key] = await cache.get(`dash:${key}`, CACHE_TTL, resolver);
      } catch (err) {
        logger.error(`Dashboard widget ${key} failed`, { error: err.message });
        results[key] = { error: err.message };
      }
    }));

    res.json({ widgets: results, timing: Date.now() - now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dashboard/refresh — queue materialized view refresh
router.post('/refresh', authenticate, async (req, res) => {
  try {
    if (process.env.REDIS_URL) {
      const job = await addJob('refresh-dashboard', {});
      return res.json({ jobId: job.id, message: 'Dashboard refresh queued' });
    }
    await require('../db/pool').query('SELECT refresh_materialized_views()');
    await cache.invalidatePrefix('dash:');
    res.json({ message: 'Dashboard refreshed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
