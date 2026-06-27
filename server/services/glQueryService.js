'use strict';

/**
 * GL Query Service — Silverstar Grow ERP
 *
 * Shared, reusable GL data access layer.
 * Extracted from reports.js so that fundMovementService, cashFlowService,
 * and any future financial analytics service can consume the same functions
 * without duplicating queries.
 *
 * RULES:
 *  - Only reads from journal_entries / je_lines / accounts.
 *  - Never reads from transaction modules (invoices, payments, etc).
 *  - General Ledger is the single source of truth.
 *  - All functions are pure: they receive dates, return structured data.
 */

const pool = require('../db/pool');

// ─────────────────────────────────────────────────────────────────────────────
// buildTrialBalanceHierarchy
// Returns the full account tree with period debits/credits/net for each node.
// Identical to the private function previously in reports.js.
// ─────────────────────────────────────────────────────────────────────────────
async function buildTrialBalanceHierarchy(fromDate, toDate) {
  const result = await pool.query(
    `WITH period AS (
       SELECT jl.account_id,
              SUM(jl.debit)             AS total_debit,
              SUM(jl.credit)            AS total_credit,
              SUM(jl.debit - jl.credit) AS net_balance
       FROM je_lines jl
       JOIN journal_entries je ON je.id = jl.je_id
       WHERE je.status = 'posted' AND je.date BETWEEN $1 AND $2
       GROUP BY jl.account_id
     )
     SELECT a.id, a.code, a.name, a.type, a.sub_type, a.account_role,
            a.parent_id, a.is_group, a.level, a.path,
            COALESCE(p.total_debit,  0) AS total_debit,
            COALESCE(p.total_credit, 0) AS total_credit,
            COALESCE(p.net_balance,  0) AS net_balance
     FROM   accounts a
     LEFT JOIN period p ON p.account_id = a.id
     WHERE  a.status = 'active'
     ORDER  BY COALESCE(a.path, a.code), a.code`,
    [fromDate, toDate]
  );

  const byId = {};
  for (const r of result.rows) {
    byId[r.id] = {
      ...r,
      total_debit:  parseFloat(r.total_debit)  || 0,
      total_credit: parseFloat(r.total_credit) || 0,
      net_balance:  parseFloat(r.net_balance)  || 0,
      children: [],
    };
  }

  const roots = [];
  for (const r of result.rows) {
    const node = byId[r.id];
    if (r.parent_id && byId[r.parent_id]) {
      byId[r.parent_id].children.push(node);
    } else {
      roots.push(node);
    }
  }

  const aggregate = (node) => {
    if (!node.children.length) {
      return { debit: node.total_debit, credit: node.total_credit, net: node.net_balance };
    }
    let sumD = node.total_debit, sumC = node.total_credit, sumN = node.net_balance;
    for (const child of node.children) {
      const c = aggregate(child);
      sumD += c.debit; sumC += c.credit; sumN += c.net;
    }
    node.group_debit  = Math.round(sumD * 100) / 100;
    node.group_credit = Math.round(sumC * 100) / 100;
    node.group_net    = Math.round(sumN * 100) / 100;
    return { debit: sumD, credit: sumC, net: sumN };
  };
  roots.forEach(aggregate);
  return roots;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildAccountHierarchy
// Returns tree of a single account type (asset/liability/equity) with
// cumulative balances as-of a date. Used by Balance Sheet.
// Identical to the private function previously in reports.js.
// ─────────────────────────────────────────────────────────────────────────────
async function buildAccountHierarchy(type, asOfDate) {
  const result = await pool.query(
    `WITH ledger AS (
       SELECT jl.account_id,
              SUM(jl.debit)  AS total_debit,
              SUM(jl.credit) AS total_credit
       FROM   je_lines jl
       JOIN   journal_entries je ON je.id = jl.je_id
       WHERE  je.status = 'posted' AND je.date <= $1
       GROUP  BY jl.account_id
     )
     SELECT a.id, a.code, a.name, a.parent_id, a.is_group, a.level, a.path,
            a.sub_type, a.account_role,
            CASE WHEN a.type IN ('asset','expense')
                 THEN COALESCE(l.total_debit, 0) - COALESCE(l.total_credit, 0)
                 ELSE COALESCE(l.total_credit, 0) - COALESCE(l.total_debit, 0)
            END AS balance
     FROM   accounts a
     LEFT JOIN ledger l ON l.account_id = a.id
     WHERE  a.type = $2 AND a.status = 'active'
     ORDER  BY COALESCE(a.path, a.code), a.code`,
    [asOfDate, type]
  );

  const byId = {};
  for (const row of result.rows) {
    byId[row.id] = { ...row, balance: parseFloat(row.balance) || 0, children: [] };
  }
  const roots = [];
  for (const row of result.rows) {
    const node = byId[row.id];
    if (row.parent_id && byId[row.parent_id]) {
      byId[row.parent_id].children.push(node);
    } else {
      roots.push(node);
    }
  }
  const calcTotal = (node) => {
    if (!node.children.length) return node.balance;
    const childSum = node.children.reduce((s, c) => s + calcTotal(c), 0);
    node.group_total = Math.round((node.balance + childSum) * 100) / 100;
    return node.group_total;
  };
  roots.forEach(calcTotal);
  return roots;
}

// ─────────────────────────────────────────────────────────────────────────────
// getAccountBalancesFlat
// Returns all leaf accounts with their cumulative GL balance as-of a date.
// Single efficient query — the base for fund movement calculations.
// ─────────────────────────────────────────────────────────────────────────────
async function getAccountBalancesFlat(asOfDate) {
  const result = await pool.query(
    `WITH ledger AS (
       SELECT jl.account_id,
              SUM(jl.debit)  AS total_debit,
              SUM(jl.credit) AS total_credit
       FROM   je_lines jl
       JOIN   journal_entries je ON je.id = jl.je_id
       WHERE  je.status = 'posted' AND je.date <= $1
       GROUP  BY jl.account_id
     )
     SELECT a.id, a.code, a.name, a.type, a.sub_type, a.account_role,
            a.parent_id, a.is_group,
            COALESCE(l.total_debit,  0) AS total_debit,
            COALESCE(l.total_credit, 0) AS total_credit,
            CASE WHEN a.type IN ('asset','expense')
                 THEN COALESCE(l.total_debit, 0) - COALESCE(l.total_credit, 0)
                 ELSE COALESCE(l.total_credit, 0) - COALESCE(l.total_debit, 0)
            END AS balance
     FROM   accounts a
     LEFT JOIN ledger l ON l.account_id = a.id
     WHERE  a.is_group = false AND a.status = 'active'
     ORDER  BY a.code`,
    [asOfDate]
  );

  return result.rows.map(r => ({
    id:           r.id,
    code:         r.code,
    name:         r.name,
    type:         r.type,
    sub_type:     r.sub_type,
    account_role: r.account_role,
    parent_id:    r.parent_id,
    is_group:     r.is_group,
    total_debit:  parseFloat(r.total_debit)  || 0,
    total_credit: parseFloat(r.total_credit) || 0,
    balance:      parseFloat(r.balance)      || 0,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// getAccountMovements
// Returns all leaf accounts with PERIOD debits/credits (not cumulative).
// Used for Sources & Applications of Funds (what moved in the period).
// ─────────────────────────────────────────────────────────────────────────────
async function getAccountMovements(fromDate, toDate) {
  const result = await pool.query(
    `WITH period AS (
       SELECT jl.account_id,
              SUM(jl.debit)  AS total_debit,
              SUM(jl.credit) AS total_credit
       FROM   je_lines jl
       JOIN   journal_entries je ON je.id = jl.je_id
       WHERE  je.status = 'posted' AND je.date BETWEEN $1 AND $2
       GROUP  BY jl.account_id
     )
     SELECT a.id, a.code, a.name, a.type, a.sub_type, a.account_role,
            a.parent_id, a.is_group,
            COALESCE(p.total_debit,  0) AS total_debit,
            COALESCE(p.total_credit, 0) AS total_credit
     FROM   accounts a
     LEFT JOIN period p ON p.account_id = a.id
     WHERE  a.is_group = false AND a.status = 'active'
       AND (COALESCE(p.total_debit, 0) > 0 OR COALESCE(p.total_credit, 0) > 0)
     ORDER  BY a.code`,
    [fromDate, toDate]
  );

  return result.rows.map(r => ({
    id:           r.id,
    code:         r.code,
    name:         r.name,
    type:         r.type,
    sub_type:     r.sub_type,
    account_role: r.account_role,
    parent_id:    r.parent_id,
    total_debit:  parseFloat(r.total_debit)  || 0,
    total_credit: parseFloat(r.total_credit) || 0,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// getAccountJournalEntries
// Returns all posted JE lines for a specific account within a date range.
// Powers the drill-down from any dashboard figure → journal entries.
// ─────────────────────────────────────────────────────────────────────────────
async function getAccountJournalEntries(accountId, fromDate, toDate) {
  const result = await pool.query(
    `SELECT je.id AS je_id, je.je_number, je.date, je.description,
            je.source_type, je.source_id, je.reference_no,
            jl.debit, jl.credit, jl.narration,
            a.id AS account_id, a.code AS account_code, a.name AS account_name
     FROM   je_lines jl
     JOIN   journal_entries je ON je.id = jl.je_id
     JOIN   accounts a ON a.id = jl.account_id
     WHERE  jl.account_id = $1
       AND  je.status = 'posted'
       AND  je.date BETWEEN $2 AND $3
     ORDER  BY je.date DESC, je.id DESC`,
    [accountId, fromDate, toDate]
  );

  return result.rows.map(r => ({
    je_id:        r.je_id,
    je_number:    r.je_number,
    date:         r.date,
    description:  r.description,
    source_type:  r.source_type,
    source_id:    r.source_id,
    reference_no: r.reference_no,
    debit:        parseFloat(r.debit)  || 0,
    credit:       parseFloat(r.credit) || 0,
    narration:    r.narration,
  }));
}

module.exports = {
  buildTrialBalanceHierarchy,
  buildAccountHierarchy,
  getAccountBalancesFlat,
  getAccountMovements,
  getAccountJournalEntries,
};
