const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const pool = require('../db/pool');
const cache = require('../db/cache');

async function test() {
  try {
    const DUE_DAYS_SQL = `
      CASE WHEN pn.payment_term ~ '[0-9]'
           THEN regexp_replace(pn.payment_term, '[^0-9]', '', 'g')::int
           ELSE 0
      END`;
    const status = undefined;
    const category = undefined;
    const search = undefined;
    const limit = '500';
    const offset = '0';
    const cacheKey = `vendor_list_${status || 'all'}_${category || 'all'}_${search || ''}_${limit}_${offset}`;

    const data = await cache.get(cacheKey, 30, async () => {
      const params = [];
      const conds  = ['1=1'];

      if (status)   { params.push(status);            conds.push(`v.status = $${params.length}`); }
      if (category) { params.push(category);          conds.push(`v.category = $${params.length}`); }
      if (search) {
        params.push(`%${search}%`);
        conds.push(`(v.name ILIKE $${params.length} OR v.code ILIKE $${params.length})`);
      }
      const where = conds.join(' AND ');

      const countR = await pool.query(
        `SELECT COUNT(v.id) FROM vendors v WHERE ${where}`, params
      );
      const total = parseInt(countR.rows[0].count);

      params.push(parseInt(limit));  const lp = params.length;
      params.push(parseInt(offset)); const op = params.length;

      const result = await pool.query(`
        WITH paginated_vendors AS (
          SELECT * FROM vendors v
          WHERE ${where}
          ORDER BY v.name
          LIMIT $${lp} OFFSET $${op}
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
      `, params);

      return { data: result.rows, total };
    });
    console.log("SUCCESS:", data.data.length);
  } catch (err) {
    console.error("ERROR:", err.message);
  } finally {
    process.exit(0);
  }
}
test();
