/**
 * sync_asset_categories_from_templates.js
 *
 * One-time sync script: for every fixed_asset that has a template_id set,
 * if the asset's category_id differs from the template's current category_id
 * (and the asset has NO posted depreciation), update the asset's category_id
 * to match the template.
 *
 * This script handles the case where Asset Templates were recategorised BEFORE
 * the cascade logic was deployed, leaving existing assets in the old category.
 *
 * Usage:
 *   node server/scripts/sync_asset_categories_from_templates.js
 */

'use strict';

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || process.env.PGDATABASE,
  user:     process.env.DB_USER     || process.env.PGUSER,
  password: process.env.DB_PASSWORD || process.env.PGPASSWORD,
  ssl:      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function syncAssetCategoriesFromTemplates() {
  const client = await pool.connect();
  try {
    console.log('Searching for assets whose category differs from their template...');

    // Find all assets that have a template AND whose category_id differs from the template's category_id
    const mismatchR = await client.query(`
      SELECT
        fa.id          AS asset_id,
        fa.asset_code,
        fa.asset_name,
        fa.category_id AS current_category_id,
        fac_old.name   AS current_category_name,
        at.id          AS template_id,
        at.name        AS template_name,
        at.category_id AS template_category_id,
        fac_new.name   AS template_category_name
      FROM fixed_assets fa
      JOIN asset_templates at ON fa.template_id = at.id
      JOIN fixed_asset_categories fac_old ON fa.category_id   = fac_old.id
      JOIN fixed_asset_categories fac_new ON at.category_id   = fac_new.id
      WHERE fa.category_id != at.category_id
      ORDER BY at.name, fa.asset_code
    `);

    if (mismatchR.rows.length === 0) {
      console.log('No category mismatches found. All assets are in sync.');
      return;
    }

    console.log(`Found ${mismatchR.rows.length} asset(s) out of sync:\n`);

    let updated = 0;
    let skipped = 0;

    await client.query('BEGIN');

    for (const row of mismatchR.rows) {
      // Check for posted depreciation
      const deprR = await client.query(`
        SELECT COUNT(*) FROM depreciation_run_lines drl
        JOIN depreciation_runs dr ON drl.run_id = dr.id
        WHERE drl.fixed_asset_id = $1 AND dr.status = 'posted'
      `, [row.asset_id]);

      const hasPostedDepr = parseInt(deprR.rows[0].count) > 0;

      if (hasPostedDepr) {
        console.log(`  SKIP  ${row.asset_code} - ${row.asset_name}`);
        console.log(`         Has posted depreciation. Use Asset Reclassification Utility.\n`);
        skipped++;
      } else {
        await client.query(
          'UPDATE fixed_assets SET category_id = $1, updated_at = NOW() WHERE id = $2',
          [row.template_category_id, row.asset_id]
        );
        console.log(`  FIXED ${row.asset_code} - ${row.asset_name}`);
        console.log(`         ${row.current_category_name} → ${row.template_category_name}\n`);
        updated++;
      }
    }

    await client.query('COMMIT');

    console.log('─'.repeat(50));
    console.log(`Done. Updated: ${updated} | Skipped (has depreciation): ${skipped}`);

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

syncAssetCategoriesFromTemplates();
