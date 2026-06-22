const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /api/cost-center-corrections/search-transactions
// Searches journal entries and groups them as business documents
router.get('/search-transactions', authenticate, async (req, res) => {
  try {
    const { date_from, date_to, doc_no, module_type, vendor_id, current_cost_center_id, account_id } = req.query;

    const where = [];
    const params = [];

    // Base filter: only posted entries
    where.push(`je.status = 'posted'`);

    if (date_from) {
      params.push(date_from);
      where.push(`je.date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to);
      where.push(`je.date <= $${params.length}`);
    }
    if (doc_no) {
      params.push(`%${doc_no}%`);
      // Matches both standard JE code or operational codes (which will be fetched in the CTE/join)
      where.push(`je.code ILIKE $${params.length}`);
    }
    if (module_type) {
      params.push(module_type);
      where.push(`je.entity_type = $${params.length}`);
    }

    // CTE to get the base JEs matching criteria, then we fetch the lines
    // We dynamically join operational tables to get doc numbers and vendor names
    // Note: To avoid complex joins here, we can just grab everything in one big query,
    // but the requirement is to group by document.

    const query = `
      WITH filtered_lines AS (
        SELECT jl.id AS je_line_id, jl.je_id, jl.cost_center_id, jl.account_id, jl.debit, jl.credit,
               cc.name AS current_cost_center, a.name AS account_name
          FROM je_lines jl
          LEFT JOIN cost_centers cc ON cc.id = jl.cost_center_id
          JOIN accounts a ON a.id = jl.account_id
         WHERE 1=1
           ${current_cost_center_id ? `AND jl.cost_center_id = ${pool.escapeLiteral(current_cost_center_id)}` : ''}
           ${account_id ? `AND jl.account_id = ${pool.escapeLiteral(account_id)}` : ''}
      ),
      matching_jes AS (
        SELECT je.id AS je_id, je.date AS document_date, je.entity_type AS document_type, je.code AS default_doc_no,
               -- Dynamically fetch vendor names and doc numbers if operational
               CASE 
                 WHEN je.entity_type = 'expense_voucher' THEN (SELECT v.name FROM expense_vouchers ev JOIN vendors v ON v.id = ev.vendor_id WHERE ev.id = je.entity_id)
                 WHEN je.entity_type = 'purchase_invoice' THEN (SELECT v.name FROM purchase_invoices pi JOIN vendors v ON v.id = pi.vendor_id WHERE pi.id = je.entity_id)
                 WHEN je.entity_type = 'payment' THEN (SELECT v.name FROM payments p JOIN vendors v ON v.id = p.vendor_id WHERE p.id = je.entity_id)
                 ELSE NULL
               END AS vendor_name,
               CASE
                 WHEN je.entity_type = 'expense_voucher' THEN (SELECT code FROM expense_vouchers WHERE id = je.entity_id)
                 WHEN je.entity_type = 'purchase_invoice' THEN (SELECT code FROM purchase_invoices WHERE id = je.entity_id)
                 WHEN je.entity_type = 'payment' THEN (SELECT code FROM payments WHERE id = je.entity_id)
                 WHEN je.entity_type = 'receipt' THEN (SELECT code FROM receipts WHERE id = je.entity_id)
                 ELSE je.code
               END AS document_number
          FROM journal_entries je
         WHERE ${where.join(' AND ')}
      )
      SELECT m.je_id, m.document_date, m.document_type, m.document_number, m.vendor_name,
             f.je_line_id, f.account_name, f.current_cost_center, f.debit, f.credit
        FROM matching_jes m
        JOIN filtered_lines f ON f.je_id = m.je_id
       ORDER BY m.document_date DESC, m.je_id DESC, f.je_line_id ASC
    `;

    const { rows } = await pool.query(query, params);

    // If vendor_id is filtered, we have to do it in memory or extend the query.
    // Extending query is better, but since it's dynamic CTE, doing it post-query or in the CTE works.
    let results = rows;
    if (vendor_id) {
       // simplistic filter, a proper join is better but this works safely without breaking non-vendor JEs
       const vRes = await pool.query(`SELECT name FROM vendors WHERE id = $1`, [vendor_id]);
       const vName = vRes.rows[0]?.name;
       if (vName) {
         results = results.filter(r => r.vendor_name === vName);
       }
    }

    // Group by document
    const docsMap = {};
    for (const r of results) {
      if (!docsMap[r.je_id]) {
        docsMap[r.je_id] = {
          je_id: r.je_id,
          document_date: r.document_date,
          document_type: r.document_type,
          document_number: r.document_number || 'N/A',
          vendor_name: r.vendor_name || 'N/A',
          amount: 0,
          je_lines: []
        };
      }
      docsMap[r.je_id].je_lines.push({
        je_line_id: r.je_line_id,
        account_name: r.account_name,
        current_cost_center: r.current_cost_center,
        debit: r.debit,
        credit: r.credit
      });
      // The overall document amount could just be the sum of debits
      docsMap[r.je_id].amount += Number(r.debit || 0);
    }

    res.json({ data: Object.values(docsMap) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cost-center-corrections/audit-history
// Fetch history from cost_center_audit
router.get('/audit-history', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.created_at, u.name AS user_name,
              a.old_cost_center_id, cc_old.name AS old_cost_center_name,
              a.new_cost_center_id, cc_new.name AS new_cost_center_name,
              a.reason,
              je.code AS document_number
         FROM cost_center_audit a
         LEFT JOIN users u ON u.id = a.user_id
         LEFT JOIN cost_centers cc_old ON cc_old.id = a.old_cost_center_id
         LEFT JOIN cost_centers cc_new ON cc_new.id = a.new_cost_center_id
         LEFT JOIN je_lines jl ON jl.id = a.entity_id AND a.entity_type = 'je_line'
         LEFT JOIN journal_entries je ON je.id = jl.je_id
        WHERE a.entity_type = 'je_line'
        ORDER BY a.created_at DESC
        LIMIT 200`
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
