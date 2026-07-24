/**
 * Standalone TDS Allocation Reconciliation Script
 * 
 * Mandate:
 * 1. Mode --dry-run: Reads and reports legacy TDS-generated je_allocations and affected Bills without DB mutations.
 * 2. Mode --execute: Neutralizes legacy TDS je_allocations by setting allocated_amount = 0 (preserving audit history),
 *    appends notes [NEUTRALIZED_LEGACY_TDS], and executes canonical syncBillStatus(billId) for affected Bills.
 * 3. Idempotency Guarantee: Running --execute when no positive TDS allocations exist outputs:
 *    ALREADY_RECONCILED — NO CHANGES
 */

'use strict';

const path = require('path');
const fs = require('fs');
const dotenvPath = fs.existsSync(path.join(__dirname, '../.env'))
  ? path.join(__dirname, '../.env')
  : path.join(__dirname, '../../server/.env');
require('dotenv').config({ path: dotenvPath });

const pool = require('../db/pool');
const { syncBillStatus } = require('../services/openDocumentService');

async function reconcileTdsAllocations() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isExecute = args.includes('--execute');

  if (!isDryRun && !isExecute) {
    console.log('Usage: node server/scripts/reconcileTdsAllocations.js [--dry-run | --execute]');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    // 1. Identify legacy TDS-generated je_allocations with positive allocated_amount (> 0)
    const targetRows = await client.query(`
      SELECT 
        ja.id AS alloc_id,
        ja.je_id,
        ja.target_id AS bill_id,
        ja.allocated_amount,
        ja.allocation_date,
        ja.notes,
        je.source_type,
        pn.doc_number AS bill_number,
        pn.grand_total,
        pn.balance_due AS current_bill_balance
      FROM je_allocations ja
      JOIN journal_entries je ON je.id = ja.je_id
      LEFT JOIN bill_tds_withholdings btw ON btw.posting_je_id = je.id OR btw.reversal_je_id = je.id
      LEFT JOIN purchase_notes pn ON pn.id = ja.target_id
      WHERE ja.allocated_amount > 0
        AND (
          je.source_type IN ('bill_tds_withholding', 'bill_tds_reversal')
          OR btw.id IS NOT NULL
        )
      ORDER BY ja.id ASC
    `);

    if (targetRows.rows.length === 0) {
      console.log('ALREADY_RECONCILED — NO CHANGES');
      process.exit(0);
    }

    console.log(`[TDS Reconciliation] Found ${targetRows.rows.length} legacy positive TDS allocation record(s).`);
    console.table(targetRows.rows.map(r => ({
      AllocID: r.alloc_id,
      JeID: r.je_id,
      BillID: r.bill_id,
      BillNo: r.bill_number,
      Amount: r.allocated_amount,
      SourceType: r.source_type,
      CurrentBillBalance: r.current_bill_balance
    })));

    if (isDryRun) {
      console.log('\n[DRY RUN COMPLETE] Zero database mutations performed.');
      process.exit(0);
    }

    if (isExecute) {
      await client.query('BEGIN');

      const affectedBillIds = new Set();

      for (const r of targetRows.rows) {
        affectedBillIds.add(r.bill_id);
        const newNotes = r.notes ? `[NEUTRALIZED_LEGACY_TDS] ${r.notes}` : '[NEUTRALIZED_LEGACY_TDS] Legacy TDS allocation neutralized';
        
        await client.query(`
          UPDATE je_allocations
          SET allocated_amount = 0.00,
              notes = $1
          WHERE id = $2
        `, [newNotes, r.alloc_id]);
      }

      console.log(`\n[EXECUTE] Neutralized ${targetRows.rows.length} legacy TDS allocation(s) to 0.00 amount.`);

      // Sync bill status for affected bills
      for (const billId of affectedBillIds) {
        if (billId) {
          await syncBillStatus(billId, client);
        }
      }

      await client.query('COMMIT');
      console.log(`[EXECUTE COMPLETE] Successfully synchronized status for ${affectedBillIds.size} affected Bill(s).`);
    }

  } catch (err) {
    if (isExecute) await client.query('ROLLBACK');
    console.error('[TDS Reconciliation Error]:', err);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

reconcileTdsAllocations();
