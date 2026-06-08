require('dotenv').config();
const { query } = require('./db/pool');

(async () => {
  try {
    const res = await query(`
      SELECT je.id as je_id, je.je_number, je.date, je.description, je.source_type, je.source_id, jl.debit, jl.credit, jl.narration,
              CASE
                WHEN je.source_type = 'purchase' THEN (SELECT doc_number::text FROM purchase_notes WHERE id::text = je.source_id::text)
                WHEN je.source_type = 'sales' THEN (SELECT doc_number::text FROM sales_invoices WHERE id::text = je.source_id::text)
                WHEN je.source_type = 'payment' THEN (SELECT doc_number::text FROM payments WHERE id::text = je.source_id::text)
                WHEN je.source_type = 'receipt' THEN (SELECT doc_number::text FROM receipts WHERE id::text = je.source_id::text)
                ELSE je.source_id::text
              END as doc_id
       FROM je_lines jl JOIN journal_entries je ON je.id = jl.je_id
       WHERE jl.account_id = $1 AND je.status = 'posted' 
       ORDER BY je.date, je.id
       LIMIT 1
    `, [27]);
    console.log("SUCCESS");
  } catch (err) {
    console.error("SQL ERROR:", err.message);
  } process.exit(0);
})();
