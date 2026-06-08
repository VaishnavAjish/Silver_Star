const express = require('express');
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

router.get('/accounting-health', authenticate, authorize('admin'), async (req, res) => {
  try {
    const tbR = await pool.query(
      `SELECT COALESCE(SUM(jl.debit), 0) AS debit,
              COALESCE(SUM(jl.credit), 0) AS credit
       FROM je_lines jl
       JOIN journal_entries je ON je.id = jl.je_id
       WHERE je.status = 'posted'`
    );

    const unbalancedR = await pool.query(
      `SELECT je.id, je.je_number, je.total_debit, je.total_credit,
              COALESCE(SUM(jl.debit), 0) AS line_debit,
              COALESCE(SUM(jl.credit), 0) AS line_credit
       FROM journal_entries je
       LEFT JOIN je_lines jl ON jl.je_id = je.id
       GROUP BY je.id
       HAVING ABS(je.total_debit - je.total_credit) > 0.01
          OR ABS(COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)) > 0.01
          OR ABS(je.total_debit - COALESCE(SUM(jl.debit), 0)) > 0.01
          OR ABS(je.total_credit - COALESCE(SUM(jl.credit), 0)) > 0.01
       ORDER BY je.date DESC, je.id DESC`
    );

    // Stock levels live in the inventory table, not items (items is the product master)
    const negativeStockR = await pool.query(
      `SELECT i.id, i.code, i.name, inv.quantity_on_hand, inv.total_value AS inventory_value
       FROM items i
       JOIN inventory inv ON inv.item_id = i.id
       WHERE inv.quantity_on_hand < 0 OR inv.total_value < 0
       ORDER BY i.code`
    );

    const orphanR = await pool.query(
      `SELECT je.id, je.je_number, je.source_type, je.source_id
       FROM journal_entries je
       WHERE je.source_type IS NOT NULL
         AND je.source_id IS NOT NULL
         AND (
           (je.source_type IN ('purchase') AND NOT EXISTS (SELECT 1 FROM purchase_notes pn WHERE pn.id = je.source_id))
           OR (je.source_type IN ('invoice','invoice_cogs') AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = je.source_id))
           OR (je.source_type IN ('payment') AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = je.source_id))
           OR (je.source_type IN ('receipt') AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.id = je.source_id))
           OR (je.source_type IN ('growth') AND NOT EXISTS (SELECT 1 FROM rough_growth rg WHERE rg.id = je.source_id))
         )
       ORDER BY je.id DESC`
    );

    const bsR = await pool.query(
      `WITH ledger AS (
         SELECT jl.account_id, SUM(jl.debit) AS debit, SUM(jl.credit) AS credit
         FROM je_lines jl
         JOIN journal_entries je ON je.id = jl.je_id
         WHERE je.status = 'posted'
         GROUP BY jl.account_id
       )
       SELECT
         COALESCE(SUM(CASE WHEN a.type = 'asset' THEN COALESCE(l.debit,0) - COALESCE(l.credit,0) ELSE 0 END), 0) AS assets,
         COALESCE(SUM(CASE WHEN a.type = 'liability' THEN COALESCE(l.credit,0) - COALESCE(l.debit,0) ELSE 0 END), 0) AS liabilities,
         COALESCE(SUM(CASE WHEN a.type = 'equity' THEN COALESCE(l.credit,0) - COALESCE(l.debit,0) ELSE 0 END), 0) AS equity,
         COALESCE(SUM(CASE WHEN a.type IN ('revenue','expense') THEN COALESCE(l.credit,0) - COALESCE(l.debit,0) ELSE 0 END), 0) AS retained_earnings
       FROM accounts a
       LEFT JOIN ledger l ON l.account_id = a.id
       WHERE a.is_group = false AND a.status = 'active'`
    );

    const debit = Number(tbR.rows[0].debit) || 0;
    const credit = Number(tbR.rows[0].credit) || 0;
    const bs = bsR.rows[0];
    const assets = Number(bs.assets) || 0;
    const liabilities = Number(bs.liabilities) || 0;
    const equity = Number(bs.equity) || 0;
    const retained = Number(bs.retained_earnings) || 0;

    res.json({
      trial_balance_mismatch: Math.abs(debit - credit) > 0.01,
      bs_mismatch: Math.abs(assets - liabilities - equity - retained) > 0.01,
      negative_stock_items: negativeStockR.rows,
      orphan_journal_entries: orphanR.rows,
      unbalanced_entries: unbalancedR.rows,
      totals: {
        trial_balance: { debit, credit },
        balance_sheet: { assets, liabilities, equity, retained_earnings: retained },
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
