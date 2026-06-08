const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  host: '192.168.1.53',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function run() {
  try {
    const DUE_DAYS_SQL = `
      CASE pn.payment_term 
        WHEN '7 Days' THEN 7
        WHEN '15 Days' THEN 15
        WHEN '30 Days' THEN 30
        WHEN '45 Days' THEN 45
        WHEN '60 Days' THEN 60
        WHEN '90 Days' THEN 90
        ELSE 0
      END`;
    
    console.time("Query Time");
    const result = await pool.query(`
      WITH paginated_vendors AS (
        SELECT id FROM vendors v
        WHERE 1=1
        ORDER BY v.name
        LIMIT 500 OFFSET 0
      ),
      vendor_pns AS (
        SELECT id, vendor_id, grand_total, doc_date, payment_term
        FROM purchase_notes
        WHERE status != 'cancelled' AND payment_status != 'PAID'
          AND vendor_id IN (SELECT id FROM paginated_vendors)
      ),
      vendor_allocations AS (
        SELECT pa.purchase_note_id, SUM(pa.amount) AS total_paid
        FROM payment_allocations pa
        JOIN vendor_pns pn ON pn.id = pa.purchase_note_id
        GROUP BY pa.purchase_note_id
      ),
      vendor_balances AS (
        SELECT
          pn.vendor_id,
          SUM(GREATEST(pn.grand_total - COALESCE(va.total_paid, 0), 0)) AS open_balance,
          SUM(CASE WHEN (pn.doc_date + (${DUE_DAYS_SQL})) < CURRENT_DATE
                   THEN GREATEST(pn.grand_total - COALESCE(va.total_paid, 0), 0) ELSE 0 END) AS overdue_balance
        FROM vendor_pns pn
        LEFT JOIN vendor_allocations va ON va.purchase_note_id = pn.id
        GROUP BY pn.vendor_id
      )
      SELECT
        v.*,
        COALESCE(b.open_balance,    0) AS open_balance,
        COALESCE(b.overdue_balance, 0) AS overdue_balance
      FROM vendors v
      JOIN paginated_vendors pv ON pv.id = v.id
      LEFT JOIN vendor_balances b ON b.vendor_id = v.id
      ORDER BY v.name
    `);
    console.timeEnd("Query Time");
    console.log("Result rows:", result.rows.length);
  } catch (err) {
    console.error("PG ERROR:", err.message);
  } finally {
    process.exit();
  }
}
run();
