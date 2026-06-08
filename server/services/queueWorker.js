const { logger } = require('../middleware/logger');
const { registerHandler } = require('./queueService');

// ── Accounts Payable Report Generator ────────────────────────────────────
registerHandler('accounts-payable', async (data, updateProgress) => {
  const { query: text, params } = data;
  const { query } = require('../db/pool');
  updateProgress(10);

  const result = await query(text, params, { readOnly: true });
  updateProgress(50);

  // Transform and aggregate
  const rows = result.rows;
  updateProgress(80);

  return {
    total: rows.length,
    totalAmount: rows.reduce((sum, r) => sum + parseFloat(r.amount_due || 0), 0),
    rows: rows.slice(0, 500),
    generatedAt: new Date().toISOString(),
  };
});

// ── Inventory Export ──────────────────────────────────────────────────────
registerHandler('export-inventory', async (data, updateProgress) => {
  const pool = require('../db/pool');
  updateProgress(10);

  const result = await pool.query(`
    SELECT i.id, i.lot_code, i.quantity_on_hand, i.avg_cost,
           i.status, i.location_id, l.name as location_name,
           it.name as item_name, it.category as item_category
    FROM inventory i
    JOIN items it ON it.id = i.item_id
    LEFT JOIN locations l ON l.id = i.location_id
    ORDER BY i.lot_code
  `, [], { readOnly: true });

  updateProgress(100);
  return {
    total: result.rows.length,
    rows: result.rows,
    generatedAt: new Date().toISOString(),
  };
});

// ── P&L Report Generator ─────────────────────────────────────────────────
registerHandler('pnl-report', async (data, updateProgress) => {
  const pool = require('../db/pool');
  updateProgress(10);

  const { fromDate, toDate, includeBudget = false } = data;

  // Try materialized view first
  const mvResult = await pool.query(`
    SELECT account_id, SUM(amount) as amount
    FROM mv_dashboard_financial
    WHERE month >= $1::date AND month < $2::date
    GROUP BY account_id
  `, [fromDate, toDate], { readOnly: true });

  updateProgress(50);

  if (mvResult.rows.length > 10) {
    const accountResult = await pool.query(`
      SELECT id, account_code, name, account_type, sub_type
      FROM accounts WHERE id = ANY($1)
    `, [mvResult.rows.map(r => r.account_id)], { readOnly: true });

    updateProgress(80);

    const accountMap = {};
    accountResult.rows.forEach(a => { accountMap[a.id] = a; });

    const revenue = [];
    const expenses = [];

    mvResult.rows.forEach(r => {
      const acct = accountMap[r.account_id];
      if (!acct) return;
      const entry = {
        accountId: acct.id,
        code: acct.account_code,
        name: acct.name,
        type: acct.account_type,
        amount: parseFloat(r.amount) || 0,
      };
      if (acct.account_type === 'revenue') revenue.push(entry);
      else if (acct.account_type === 'expense') expenses.push(entry);
    });

    const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
    const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);

    updateProgress(100);
    return {
      fromDate, toDate,
      revenue, expenses,
      totalRevenue,
      totalExpenses,
      netProfit: totalRevenue - totalExpenses,
      generatedAt: new Date().toISOString(),
      source: 'materialized_view',
    };
  }

  // Fallback: direct query
  const directResult = await pool.query(`
    SELECT a.id as account_id, a.account_code, a.name, a.account_type,
           SUM(jl.debit - jl.credit) as amount
    FROM je_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.entry_date >= $1 AND je.entry_date < $2
      AND je.status = 'posted'
      AND a.account_type IN ('revenue', 'expense')
    GROUP BY a.id, a.account_code, a.name, a.account_type
    ORDER BY a.account_code
  `, [fromDate, toDate], { readOnly: true });

  updateProgress(100);
  const revenue = directResult.rows.filter(r => r.account_type === 'revenue');
  const expenses = directResult.rows.filter(r => r.account_type === 'expense');
  const totalRevenue = revenue.reduce((s, r) => s + parseFloat(r.amount || 0), 0);
  const totalExpenses = expenses.reduce((s, r) => s + parseFloat(r.amount || 0), 0);

  return {
    fromDate, toDate,
    revenue, expenses,
    totalRevenue,
    totalExpenses,
    netProfit: totalRevenue - totalExpenses,
    generatedAt: new Date().toISOString(),
    source: 'direct_query',
  };
});

// ── Dashboard Data Refresh ────────────────────────────────────────────────
registerHandler('refresh-dashboard', async (data, updateProgress) => {
  const pool = require('../db/pool');
  updateProgress(10);

  await pool.query('SELECT refresh_materialized_views()');
  updateProgress(50);

  const { healthCheck } = require('../db/pool');
  const health = await healthCheck();
  updateProgress(100);

  return {
    refreshed: true,
    timestamp: new Date().toISOString(),
    poolHealth: health,
  };
});

logger.info('Queue worker handlers registered');
console.log('Silverstar Grow queue worker ready');
console.log('Handlers: accounts-payable, export-inventory, pnl-report, refresh-dashboard');
