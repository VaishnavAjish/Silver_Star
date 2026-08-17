require('dotenv').config();
// pool exports an un-named default object with { query } or we can require the pool instance if they have it
const db = require('../db/pool');
// The pool.js actually exports { query, transaction, ... } and maybe primaryPool?
// Let's check pool.js for the exact name of the pg.Pool instance if we need `connect()`.
// Ah! earlier view_file on pool.js showed:
// module.exports = { query, transaction, primaryPool, connect: primaryPool.connect.bind(primaryPool) }
// So we can use db.connect() !

async function runForensics() {
  const queries = [
    {
      title: '=== CORRUPT PAYMENTS (PAY-1179, PAY-1240) ===',
      sql: `SELECT p.id, p.doc_number, p.vendor_id, v.name as vendor_name, p.amount, p.status, p.je_id, p.date as payment_date 
            FROM payments p
            LEFT JOIN vendors v ON p.vendor_id = v.id
            WHERE p.doc_number IN ('PAY-1179', 'PAY-1240');`
    },
    {
      title: '=== PAYMENT ALLOCATIONS ===',
      sql: `SELECT pa.id, pa.payment_id, p.doc_number, pa.purchase_note_id, pn.doc_number as note_number, pa.amount 
            FROM payment_allocations pa
            JOIN payments p ON pa.payment_id = p.id
            LEFT JOIN purchase_notes pn ON pa.purchase_note_id = pn.id
            WHERE p.doc_number IN ('PAY-1179', 'PAY-1240');`
    },
    {
      title: '=== LINKED JOURNAL ENTRIES ===',
      sql: `SELECT je.id, je.je_number, je.status, je.source_type, je.source_id, je.total_debit, je.total_credit
            FROM journal_entries je
            WHERE je.id IN (
                SELECT je_id FROM payments WHERE doc_number IN ('PAY-1179', 'PAY-1240') AND je_id IS NOT NULL
            ) OR (je.source_type = 'payment' AND je.source_id IN (
                SELECT id FROM payments WHERE doc_number IN ('PAY-1179', 'PAY-1240')
            ));`
    },
    {
      title: '=== LINKED JOURNAL LINES ===',
      sql: `SELECT jl.id, jl.je_id, je.je_number, jl.account_id, a.name as account_name, jl.debit, jl.credit
            FROM je_lines jl
            JOIN journal_entries je ON jl.je_id = je.id
            JOIN accounts a ON jl.account_id = a.id
            WHERE je.id IN (
                SELECT je_id FROM payments WHERE doc_number IN ('PAY-1179', 'PAY-1240') AND je_id IS NOT NULL
            ) OR (je.source_type = 'payment' AND je.source_id IN (
                SELECT id FROM payments WHERE doc_number IN ('PAY-1179', 'PAY-1240')
            ));`
    },
    {
      title: '=== LINKED JE ALLOCATIONS ===',
      sql: `SELECT ja.id, ja.je_id, je.je_number, ja.target_type, ja.target_id, ja.allocated_amount
            FROM je_allocations ja
            JOIN journal_entries je ON ja.je_id = je.id
            WHERE je.id IN (
                SELECT je_id FROM payments WHERE doc_number IN ('PAY-1179', 'PAY-1240') AND je_id IS NOT NULL
            ) OR (je.source_type = 'payment' AND je.source_id IN (
                SELECT id FROM payments WHERE doc_number IN ('PAY-1179', 'PAY-1240')
            ));`
    },
    {
      title: '=== VENDOR BALANCE DISCREPANCIES ===',
      sql: `WITH vendor_ids AS (
                SELECT DISTINCT vendor_id FROM payments WHERE doc_number IN ('PAY-1179', 'PAY-1240')
            ),
            actual_gl AS (
                SELECT v.vendor_id, COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) as ap_balance
                FROM vendor_ids v
                LEFT JOIN je_lines jl ON jl.entity_type = 'vendor' AND jl.entity_id = v.vendor_id
                     AND jl.account_id IN (SELECT id FROM accounts WHERE type = 'payable')
                LEFT JOIN journal_entries je ON jl.je_id = je.id AND je.status = 'posted'
                GROUP BY v.vendor_id
            ),
            expected_ap AS (
                SELECT v.vendor_id, 
                       (
                         COALESCE((SELECT SUM(grand_total) FROM purchase_notes WHERE vendor_id = v.vendor_id AND status != 'CANCELLED'), 0)
                         - COALESCE((SELECT SUM(amount) FROM payments WHERE vendor_id = v.vendor_id AND status IN ('COMPLETED', 'PARTIAL')), 0)
                         - COALESCE((SELECT SUM(amount) FROM debit_notes WHERE vendor_id = v.vendor_id AND status != 'CANCELLED'), 0)
                       ) as expected_balance
                FROM vendor_ids v
            )
            SELECT e.vendor_id, v.name, e.expected_balance, g.ap_balance, 
                   (g.ap_balance - e.expected_balance) as discrepancy
            FROM expected_ap e
            JOIN actual_gl g ON e.vendor_id = g.vendor_id
            JOIN vendors v ON e.vendor_id = v.id;`
    }
  ];

  let client;
  try {
    client = await db.connect();
    await client.query('BEGIN');
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY');
    await client.query("SET statement_timeout = '60s'");

    for (const q of queries) {
      console.log('\n' + q.title);
      const res = await client.query(q.sql);
      if (res.rows.length === 0) {
        console.log('(No results)');
      } else {
        console.table(res.rows);
      }
    }
    await client.query('ROLLBACK');
  } catch (err) {
    console.error('Forensics failed:', err);
    if (client) await client.query('ROLLBACK');
  } finally {
    if (client) client.release();
    process.exit(0);
  }
}

runForensics();
