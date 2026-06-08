require('dotenv').config();
const pool = require('./db/pool');
const DUE_DAYS_SQL = `
  CASE WHEN pn.payment_term ~ '[0-9]'
       THEN regexp_replace(pn.payment_term, '[^0-9]', '', 'g')::int
       ELSE 0
  END`;

const sql = `
        SELECT
          COALESCE(SUM(GREATEST(pn.grand_total - COALESCE(pa_agg.total_paid, 0), 0)), 0) AS total_payables,
          COALESCE(SUM(
            CASE WHEN (pn.doc_date + INTERVAL '1 day' * (${DUE_DAYS_SQL}))::date < CURRENT_DATE
                 THEN GREATEST(pn.grand_total - COALESCE(pa_agg.total_paid, 0), 0) ELSE 0 END
          ), 0) AS overdue,
          (SELECT COALESCE(SUM(amount), 0)
             FROM payments
            WHERE date >= CURRENT_DATE - INTERVAL '30 days') AS paid_last_30
        FROM purchase_notes pn
        LEFT JOIN (
          SELECT purchase_note_id, SUM(amount) AS total_paid
          FROM   payment_allocations
          GROUP  BY purchase_note_id
        ) pa_agg ON pa_agg.purchase_note_id = pn.id
        WHERE pn.payment_status != 'PAID' AND pn.status != 'cancelled'
`;


pool.query(sql)
  .then(res => console.log('Summary OK:', res.rows))
  .catch(err => console.error('Summary Error:', err.message))
  .finally(() => pool.shutdown());
