const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../middleware/logger');

const router = express.Router();

// GET /api/search?q=<text>&limit=<n>
// Fuzzy search across all entity tables using pg_trgm similarity.
// Each sub-SELECT is wrapped in a derived table so ORDER BY + LIMIT
// are applied per-entity before the outer UNION ALL + ORDER BY.
router.get('/', authenticate, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) return res.json({ results: [] });

    const limit  = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const perType = 5; // cap per entity type

    const sql = `
      SELECT type, id, label, subtitle, url, score
      FROM (

        SELECT * FROM (
          SELECT
            'inventory'                                        AS type,
            id::text                                           AS id,
            lot_number || COALESCE(' — ' || lot_name, '')     AS label,
            status || COALESCE(' · ' || unit, '')             AS subtitle,
            '/inventory'                                       AS url,
            GREATEST(
              similarity($1, lot_number),
              similarity($1, COALESCE(lot_name, ''))
            )                                                  AS score
          FROM inventory
          WHERE lot_number ILIKE '%' || $1 || '%'
             OR lot_name   ILIKE '%' || $1 || '%'
             OR similarity($1, lot_number)              > 0.1
             OR similarity($1, COALESCE(lot_name, '')) > 0.1
          ORDER BY score DESC
          LIMIT $2
        ) inv

        UNION ALL

        SELECT * FROM (
          SELECT
            'invoice'                                          AS type,
            id::text,
            doc_number || COALESCE(' — ' || remark, '')       AS label,
            'Invoice · ' || payment_status                    AS subtitle,
            '/invoices/' || id                                 AS url,
            similarity($1, doc_number)                        AS score
          FROM invoices
          WHERE doc_number ILIKE '%' || $1 || '%'
             OR similarity($1, doc_number) > 0.1
          ORDER BY score DESC
          LIMIT $2
        ) inv2

        UNION ALL

        SELECT * FROM (
          SELECT
            'voucher'                                          AS type,
            id::text,
            je_number || COALESCE(' — ' || description, '')   AS label,
            'Voucher · ' || status::text                      AS subtitle,
            '/journal-entries/' || id                          AS url,
            similarity($1, je_number)                         AS score
          FROM journal_entries
          WHERE je_number ILIKE '%' || $1 || '%'
             OR similarity($1, je_number) > 0.1
          ORDER BY score DESC
          LIMIT $2
        ) je

        UNION ALL

        SELECT * FROM (
          SELECT
            'account'                                          AS type,
            id::text,
            code || ' — ' || name                             AS label,
            type::text                                         AS subtitle,
            '/accounts'                                        AS url,
            GREATEST(
              similarity($1, code),
              similarity($1, name)
            )                                                  AS score
          FROM accounts
          WHERE code ILIKE '%' || $1 || '%'
             OR name  ILIKE '%' || $1 || '%'
             OR similarity($1, code) > 0.1
             OR similarity($1, name) > 0.1
          ORDER BY score DESC
          LIMIT $2
        ) acc

        UNION ALL

        SELECT * FROM (
          SELECT
            'customer'                                         AS type,
            id::text,
            code || ' — ' || name                             AS label,
            'Customer · ' || COALESCE(city, '')               AS subtitle,
            '/masters/customers'                               AS url,
            GREATEST(
              similarity($1, code),
              similarity($1, name)
            )                                                  AS score
          FROM customers
          WHERE code ILIKE '%' || $1 || '%'
             OR name  ILIKE '%' || $1 || '%'
             OR similarity($1, code) > 0.1
             OR similarity($1, name) > 0.1
          ORDER BY score DESC
          LIMIT $2
        ) cust

        UNION ALL

        SELECT * FROM (
          SELECT
            'vendor'                                           AS type,
            id::text,
            code || ' — ' || name                             AS label,
            'Vendor · ' || COALESCE(city, '')                 AS subtitle,
            '/masters/vendors'                                 AS url,
            GREATEST(
              similarity($1, code),
              similarity($1, name)
            )                                                  AS score
          FROM vendors
          WHERE code ILIKE '%' || $1 || '%'
             OR name  ILIKE '%' || $1 || '%'
             OR similarity($1, code) > 0.1
             OR similarity($1, name) > 0.1
          ORDER BY score DESC
          LIMIT $2
        ) vend

        UNION ALL

        SELECT * FROM (
          SELECT
            'fixed_asset'                                      AS type,
            id::text,
            asset_code || ' — ' || asset_name                 AS label,
            'Asset · ' || status::text                        AS subtitle,
            '/assets/' || id                                   AS url,
            GREATEST(
              similarity($1, asset_code),
              similarity($1, asset_name)
            )                                                  AS score
          FROM fixed_assets
          WHERE asset_code ILIKE '%' || $1 || '%'
             OR asset_name  ILIKE '%' || $1 || '%'
             OR similarity($1, asset_code) > 0.1
             OR similarity($1, asset_name) > 0.1
          ORDER BY score DESC
          LIMIT $2
        ) fa

      ) all_results
      ORDER BY score DESC
      LIMIT $3;
    `;

    const { rows } = await pool.query(sql, [q, perType, limit]);
    res.json({ results: rows });
  } catch (err) {
    logger.error('Search error:', { error: err.message });
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
