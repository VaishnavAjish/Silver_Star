require('dotenv').config();
const { Client } = require('pg'); 
(async () => {
  const c = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'silverstar_grow',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
  await c.connect();
  try {
    const res = await c.query(`
      SELECT je.id as je_id, je.je_number, je.date, je.description, je.source_type, je.source_id, jl.debit, jl.credit, jl.narration,
              CASE
                WHEN je.source_type = 'purchase' THEN (SELECT doc_number::text FROM purchase_notes WHERE id::text = je.source_id::text)
                WHEN je.source_type = 'sales' THEN (SELECT doc_number::text FROM sales_invoices WHERE id::text = je.source_id::text)
                WHEN je.source_type = 'payment' THEN (SELECT doc_number::text FROM payments WHERE id::text = je.source_id::text)
                WHEN je.source_type = 'receipt' THEN (SELECT doc_number::text FROM receipts WHERE id::text = je.source_id::text)
                ELSE je.source_id::text
              END as doc_id
       FROM je_lines jl JOIN journal_entries je ON je.id = jl.je_id
       LIMIT 1
    `);
    console.log("SUCCESS");
  } catch (err) {
    console.error("SQL ERROR:", err.message);
  } finally {
    await c.end();
  }
})();
