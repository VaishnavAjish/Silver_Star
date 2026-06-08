require('dotenv').config();
const pool = require('./db/pool');

async function test() {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');
    
    // Attempt to insert a purchase note
    const pnR = await client.query(`
      INSERT INTO purchase_notes (doc_number, doc_date, vendor_id, item_type, department_id,
        payment_term, currency, reference_no, remark, total_qty, total_amount, tax_amount, grand_total,
        balance_due, amount_paid, payment_status, status, created_by)
       VALUES ('TEST-FK-01', NOW(), NULL, 'Seed', NULL,
       'Immediate', 'INR', 'REF123', 'Testing FK',
       1, 100, 0, 100, 100, 0, 'UNPAID', 'open', 1) RETURNING *
    `);
    console.log('Inserted purchase note with ID:', pnR.rows[0].id);

    // Attempt to insert a purchase note line
    const lineR = await client.query(`
      INSERT INTO purchase_note_lines
        (purchase_note_id,line_no,item_id,description,batch_no,
        qty,unit,rate,amount,tax_pct,tax_amount,total,inventory_id)
      VALUES ($1, 1, (SELECT id FROM items LIMIT 1), 'Test Line', 'BATCH', 1, 'PCS', 100, 100, 0, 0, 100, NULL) RETURNING *
    `, [pnR.rows[0].id]);
    console.log('Inserted purchase note line with ID:', lineR.rows[0].id);

    await client.query('ROLLBACK');
    console.log('Test successful, rolled back.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error during test:', err);
  } finally {
    client.release();
    process.exit();
  }
}
test();
