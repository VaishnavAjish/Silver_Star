require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../db/pool');

async function fixHistoricalAssets() {
  const client = await pool.primaryPool.connect();
  try {
    await client.query('BEGIN');

    console.log('Searching for incorrectly capitalized fixed assets...');
    
    // Find assets where purchase_cost == total_invoice_value and gst_claimable_amount > 0 and gst_treatment = 'claimable'
    const result = await client.query(`
      SELECT fa.id, fa.asset_name, fa.purchase_cost, fa.taxable_value, fa.gst_claimable_amount, fa.total_invoice_value
      FROM fixed_assets fa
      WHERE fa.gst_treatment = 'claimable'
        AND fa.gst_claimable_amount > 0
        AND fa.purchase_cost = fa.total_invoice_value
    `);

    if (result.rows.length === 0) {
      console.log('No assets found that need correction.');
      await client.query('ROLLBACK');
      return;
    }

    console.log(`Found ${result.rows.length} asset(s) to fix.`);

    // Get the GST account
    const gstAccRes = await client.query(`SELECT id FROM accounts WHERE account_role = 'GST_PAYABLE' LIMIT 1`);
    if (gstAccRes.rows.length === 0) {
      throw new Error("Could not find GST_PAYABLE account.");
    }
    const gstAccountId = gstAccRes.rows[0].id;

    for (const asset of result.rows) {
      console.log(`Fixing Asset: ${asset.asset_name} (ID: ${asset.id})`);
      
      const newPurchaseCost = asset.taxable_value; // Because claimable = 100% of GST
      const claimableGst = asset.gst_claimable_amount;

      // 1. Update the Fixed Asset record
      await client.query(`UPDATE fixed_assets SET purchase_cost = $1 WHERE id = $2`, [newPurchaseCost, asset.id]);
      console.log(`  -> Updated purchase_cost to ${newPurchaseCost}`);

      // 2. Find the Journal Entry
      const jeRes = await client.query(`SELECT id FROM journal_entries WHERE source_type = 'fixed_asset_purchase' AND source_id = $1`, [asset.id]);
      
      if (jeRes.rows.length > 0) {
        const jeId = jeRes.rows[0].id;

        // Find the debit line for the Asset
        const linesRes = await client.query(`SELECT id, account_id, debit, credit FROM journal_entry_lines WHERE journal_entry_id = $1`, [jeId]);
        
        const assetLine = linesRes.rows.find(l => parseFloat(l.debit) == parseFloat(asset.purchase_cost));
        
        if (assetLine) {
          // Update the asset line's debit to the new purchase cost
          await client.query(`UPDATE journal_entry_lines SET debit = $1 WHERE id = $2`, [newPurchaseCost, assetLine.id]);
          
          // Insert a new line for the GST debit
          await client.query(`
            INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit)
            VALUES ($1, $2, $3, 0)
          `, [jeId, gstAccountId, claimableGst]);
          
          console.log(`  -> Fixed Journal Entry (ID: ${jeId}): Split ${asset.purchase_cost} into Asset (${newPurchaseCost}) and GST (${claimableGst})`);
        } else {
           console.log(`  -> Warning: Could not find matching debit line of ${asset.purchase_cost} in JE ${jeId}`);
        }
      } else {
        console.log(`  -> Warning: No journal entry found for this asset.`);
      }
    }

    await client.query('COMMIT');
    console.log('\nSuccessfully corrected the historical assets!');
    console.log('The Fixed Asset Register and Trial Balance will now reflect the correct amounts.');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error fixing assets:', err);
  } finally {
    client.release();
    pool.shutdown();
    process.exit(0);
  }
}

fixHistoricalAssets();
