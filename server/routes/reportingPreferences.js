const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticate, authorize } = require('../middleware/auth');
const { logger } = require('../middleware/logger');

// Get company reporting preferences
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM company_reporting_preferences WHERE id = true`);
    if (result.rows.length === 0) {
      return res.json({
        base_currency: 'INR',
        reporting_currency: 'USD',
        reporting_exchange_rate: 85.000000,
        display_currency: 'INR',
        number_format: 'INDIAN',
        decimal_precision: 2,
        negative_number_style: 'ACCOUNTING'
      });
    }
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'Error fetching reporting preferences');
    res.status(500).json({ error: 'Failed to fetch reporting preferences' });
  }
});

// Update company reporting preferences
router.put('/', authenticate, authorize('admin', 'management'), async (req, res) => {
  const {
    base_currency = 'INR',
    reporting_currency = 'USD',
    reporting_exchange_rate = 85.000000,
    display_currency = 'INR',
    number_format = 'INDIAN',
    decimal_precision = 2,
    negative_number_style = 'ACCOUNTING'
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO company_reporting_preferences (
        id, base_currency, reporting_currency, reporting_exchange_rate, 
        display_currency, number_format, decimal_precision, negative_number_style
      ) VALUES (
        true, $1, $2, $3, $4, $5, $6, $7
      ) ON CONFLICT (id) DO UPDATE SET
        base_currency = EXCLUDED.base_currency,
        reporting_currency = EXCLUDED.reporting_currency,
        reporting_exchange_rate = EXCLUDED.reporting_exchange_rate,
        display_currency = EXCLUDED.display_currency,
        number_format = EXCLUDED.number_format,
        decimal_precision = EXCLUDED.decimal_precision,
        negative_number_style = EXCLUDED.negative_number_style,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *`,
      [
        base_currency, reporting_currency, reporting_exchange_rate,
        display_currency, number_format, decimal_precision, negative_number_style
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'Error updating reporting preferences');
    res.status(500).json({ error: 'Failed to update reporting preferences' });
  }
});

module.exports = router;
