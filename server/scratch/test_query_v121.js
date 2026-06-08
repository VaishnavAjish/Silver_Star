const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db/pool');

async function run() {
  try {
    const DUE_DAYS_SQL = `
      CASE WHEN pn.payment_term ~ '[0-9]'
           THEN regexp_replace(pn.payment_term, '[^0-9]', '', 'g')::int
           ELSE 0
      END`;
    
    // Test the count query
    const countR = await pool.query(`SELECT COUNT(v.id) FROM vendors v WHERE 1=1`);
    console.log("Count:", countR.rows[0].count);

    // Test the main query
    const result = await pool.query(`
      WITH paginated_vendors AS (
        SELECT * FROM vendors v
        WHERE 1=1
        ORDER BY v.name
        LIMIT 500 OFFSET 0
      )
      SELECT
        v.*,
        COALESCE(b.open_balance,    0) AS open_balance,
        COALESCE(b.overdue_balance, 0) AS overdue_balance
      FROM paginated_vendors v
      LEFT JOIN (
        SELECT
          pn.vendor_id,
          SUM(GREATEST(pn.grand_total - COALESCE(pa_agg.total_paid, 0), 0)) AS open_balance,
          SUM(CASE WHEN (pn.doc_date + INTERVAL '1 day' * (${DUE_DAYS_SQL}))::date < CURRENT_DATE
                   THEN GREATEST(pn.grand_total - COALESCE(pa_agg.total_paid, 0), 0) ELSE 0 END) AS overdue_balance
        FROM purchase_notes pn
        LEFT JOIN (
          SELECT purchase_note_id, SUM(amount) AS total_paid
          FROM payment_allocations
          GROUP BY purchase_note_id
        ) pa_agg ON pa_agg.purchase_note_id = pn.id
        WHERE pn.status != 'cancelled' AND pn.payment_status != 'PAID'
          AND pn.vendor_id IN (SELECT id FROM paginated_vendors)
        GROUP BY pn.vendor_id
      ) b ON b.vendor_id = v.id
    `);
    console.log("Result rows:", result.rows.length);
  } catch (err) {
    console.error("PG ERROR:", err);
  } finally {
    process.exit();
  }
}
run();
