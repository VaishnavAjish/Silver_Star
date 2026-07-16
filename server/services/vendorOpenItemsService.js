const pool = require('../db/pool');

/**
 * Phase 4.9: Vendor Open Items Engine
 * Consolidates all open AP documents into a single source of truth.
 * Currently supports:
 * - Posted Purchase Notes
 * - Posted Expense Bills
 * (Both are physically stored in purchase_notes)
 */
async function getVendorOpenItems(vendorId, asOfDate = null, excludeJeId = null) {
  if (!vendorId) {
    throw new Error('vendorId is required');
  }

  const conditions = [
    `vendor_id = $1`,
    `status = 'posted'`,
    `COALESCE(balance_due, grand_total) > 0.005` // Ignore fully paid
  ];
  
  const params = [parseInt(vendorId)];
  let idx = 2;

  if (asOfDate) {
    conditions.push(`doc_date <= $${idx++}`);
    params.push(asOfDate);
  }

  const whereClause = conditions.join(' AND ');

  const query = `
    SELECT 
      CASE WHEN item_type = 'Expense Bill' THEN 'expense' ELSE 'purchase_note' END AS source_type,
      id AS source_id,
      doc_number AS voucher_no,
      doc_date AS voucher_date,
      due_date,
      vendor_id,
      remark AS description,
      grand_total AS original_amount,
      COALESCE(amount_paid, 0) AS amount_paid,
      COALESCE(balance_due, grand_total) AS outstanding_amount,
      status
    FROM purchase_notes
    WHERE ${whereClause}
    ORDER BY doc_date ASC, id ASC
  `;

  try {
    const result = await pool.query(query, params);
    return result.rows;
  } catch (err) {
    // If Phase 4.9 columns (item_type, due_date) are missing, fallback to Phase 9 schema
    try {
      const phase9FallbackQuery = `
        SELECT 
          'purchase_note' AS source_type,
          id AS source_id,
          doc_number AS voucher_no,
          doc_date AS voucher_date,
          doc_date AS due_date, -- Use doc_date if due_date is missing
          vendor_id,
          remark AS description,
          grand_total AS original_amount,
          COALESCE(amount_paid, 0) AS amount_paid,
          COALESCE(balance_due, grand_total) AS outstanding_amount,
          'posted' AS status
        FROM purchase_notes
        WHERE vendor_id = $1 
          AND status != 'cancelled'
          AND COALESCE(payment_status, 'UNPAID') != 'PAID'
          AND COALESCE(balance_due, grand_total) > 0.005
        ORDER BY doc_date ASC, id ASC
      `;
      const phase9Result = await pool.query(phase9FallbackQuery, [parseInt(vendorId)]);
      return phase9Result.rows;
    } catch (phase9Err) {
      // If Phase 9 columns are also missing, fallback to base Phase 1 schema
      const phase1FallbackQuery = `
        SELECT 
          'purchase_note' AS source_type,
          id AS source_id,
          doc_number AS voucher_no,
          doc_date AS voucher_date,
          doc_date AS due_date,
          vendor_id,
          remark AS description,
          grand_total AS original_amount,
          0 AS amount_paid,
          grand_total AS outstanding_amount,
          'posted' AS status
        FROM purchase_notes
        WHERE vendor_id = $1 AND status != 'cancelled'
        ORDER BY doc_date ASC, id ASC
      `;
      const phase1Result = await pool.query(phase1FallbackQuery, [parseInt(vendorId)]);
      return phase1Result.rows;
    }
  }
}

module.exports = {
  getVendorOpenItems
};
