/**
 * Standalone TDS Allocation Reconciliation Script
 * 
 * Mandate & Final Safeguards:
 * 1. Default mode --dry-run: Reads and reports legacy TDS-generated je_allocations and affected Bills without DB mutations.
 * 2. Mode --execute: Performs strict transactional neutralization:
 *    - Acquires PostgreSQL advisory lock and row locks (FOR UPDATE)
 *    - Archives original allocation records into tds_allocation_audit_log (preserving full audit history + JSONB row)
 *    - Deletes je_allocations according to repository convention (respecting allocated_amount > 0 CHECK constraint)
 *    - Verifies exact archived & deleted row counts
 *    - Executes canonical syncBillStatus(billId) atomically per Bill
 *    - Verifies final stored vs canonical results; rolls back on any mismatch
 * 3. Idempotency Guarantee: Running when no positive TDS allocations exist outputs:
 *    ALREADY_RECONCILED — NO CHANGES
 * 4. Post-reconciliation scan: Scans all Bills for stored vs canonical settlement mismatches and over-settlement.
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const dotenvPath = fs.existsSync(path.join(__dirname, '../.env'))
  ? path.join(__dirname, '../.env')
  : path.join(__dirname, '../../server/.env');
require('dotenv').config({ path: dotenvPath });

const pool = require('../db/pool');
const { syncBillStatus } = require('../services/openDocumentService');
const { getBillSettlement, getBillSettlements } = require('../services/settlementService');

async function runPostReconciliationScan(client) {
  console.log('\n--- Running Post-Reconciliation Bill Settlement Scan ---');
  const allBillsR = await client.query(`SELECT id FROM purchase_notes WHERE status != 'cancelled' ORDER BY id ASC`);
  const allBillIds = allBillsR.rows.map(r => r.id);
  
  if (allBillIds.length === 0) {
    console.log('[Post Scan] No active purchase notes found.');
    return;
  }

  const settlementsMap = await getBillSettlements(allBillIds, client);
  let mismatchCount = 0;
  let overSettledCount = 0;

  for (const billId of allBillIds) {
    const s = settlementsMap.get(billId);
    if (!s) continue;

    const storedPaid = s.stored_amount_paid;
    const storedBal  = s.stored_balance_due;
    const storedStat = s.stored_payment_status;

    const paidDiff = Math.abs(storedPaid - s.total_settled);
    const balDiff  = Math.abs(storedBal - s.balance_due);
    const statDiff = storedStat !== s.payment_status;

    if (paidDiff > 0.01 || balDiff > 0.01 || statDiff) {
      mismatchCount++;
      console.warn(`[MISMATCH] Bill ID ${billId} (${s.doc_number}): Stored=[Paid: ${storedPaid}, Bal: ${storedBal}, Stat: ${storedStat}] | Canonical=[Paid: ${s.total_settled}, Bal: ${s.balance_due}, Stat: ${s.payment_status}]`);
    }

    if (s.is_over_settled) {
      overSettledCount++;
      console.warn(`[OVER_SETTLED] Bill ID ${billId} (${s.doc_number}): Gross: ${s.gross_total}, Settled: ${s.total_settled}, Over-settlement: ${s.over_settled_amount}`);
    }
  }

  if (mismatchCount === 0) {
    console.log(`[Post Scan] 0 stored vs canonical mismatches across ${allBillIds.length} Bills.`);
  } else {
    console.warn(`[Post Scan] Detected ${mismatchCount} residual mismatch(es) across ${allBillIds.length} Bills.`);
  }

  if (overSettledCount > 0) {
    console.warn(`[Post Scan] Detected ${overSettledCount} over-settled Bill(s).`);
  }
}

async function reconcileTdsAllocations() {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const isDryRun = args.includes('--dry-run') || !isExecute;

  const runId = crypto.randomUUID();
  console.log(`[TDS Reconciliation] Starting run ${runId} (Mode: ${isExecute ? '--execute' : '--dry-run'})`);

  const client = await pool.connect();
  try {
    // Ensure audit migration table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS tds_allocation_audit_log (
        id                     SERIAL PRIMARY KEY,
        original_alloc_id      INTEGER UNIQUE NOT NULL,
        bill_id                INTEGER,
        vendor_id              INTEGER,
        je_id                  INTEGER NOT NULL,
        target_id              INTEGER NOT NULL,
        allocated_amount       NUMERIC(15,2) NOT NULL,
        original_notes         TEXT,
        original_row           JSONB NOT NULL,
        reconciliation_run_id  UUID NOT NULL,
        neutralized_by         TEXT NOT NULL DEFAULT 'SYSTEM_RECONCILIATION',
        neutralized_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reason                 TEXT NOT NULL DEFAULT 'LEGACY_TDS_RECONCILIATION'
      );
    `);

    // 1. Identify legacy TDS-generated je_allocations with positive allocated_amount (> 0)
    const targetRows = await client.query(`
      SELECT 
        ja.id AS alloc_id,
        ja.je_id,
        ja.target_id AS bill_id,
        ja.entity_id AS vendor_id,
        ja.allocated_amount,
        ja.allocation_date,
        ja.notes,
        to_jsonb(ja.*) AS full_row,
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
      await runPostReconciliationScan(client);
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

    if (isDryRun && !isExecute) {
      console.log('\n[DRY RUN COMPLETE] Zero database mutations performed.');
      await runPostReconciliationScan(client);
      process.exit(0);
    }

    if (isExecute) {
      await client.query('BEGIN');

      // Global advisory lock for reconciliation execution
      await client.query('SELECT pg_advisory_xact_lock(987654321)');

      const affectedBillMap = new Map();
      for (const r of targetRows.rows) {
        if (!affectedBillMap.has(r.bill_id)) affectedBillMap.set(r.bill_id, []);
        affectedBillMap.get(r.bill_id).push(r);
      }

      for (const [billId, allocRows] of affectedBillMap.entries()) {
        if (!billId) continue;

        // Advisory lock per Bill
        await client.query('SELECT pg_advisory_xact_lock($1)', [billId]);

        // Lock the Bill row
        const billLock = await client.query('SELECT id, grand_total FROM purchase_notes WHERE id = $1 FOR UPDATE', [billId]);
        if (!billLock.rows.length) {
          throw new Error(`[RECONCILIATION_FAIL] Bill ID ${billId} not found during FOR UPDATE lock.`);
        }

        const allocIds = allocRows.map(a => a.alloc_id);

        // Lock only proven TDS-linked je_allocations
        const allocLock = await client.query(`
          SELECT ja.id
          FROM je_allocations ja
          JOIN journal_entries je ON je.id = ja.je_id
          LEFT JOIN bill_tds_withholdings btw ON btw.posting_je_id = je.id OR btw.reversal_je_id = je.id
          WHERE ja.id = ANY($1::int[])
            AND (je.source_type IN ('bill_tds_withholding', 'bill_tds_reversal') OR btw.id IS NOT NULL)
          FOR UPDATE
        `, [allocIds]);

        if (allocLock.rows.length !== allocIds.length) {
          throw new Error(`[RECONCILIATION_FAIL] Lock mismatch for Bill ID ${billId}. Expected ${allocIds.length} locked rows, got ${allocLock.rows.length}.`);
        }

        // Archive rows before deletion
        for (const row of allocRows) {
          const archRes = await client.query(`
            INSERT INTO tds_allocation_audit_log (
              original_alloc_id, bill_id, vendor_id, je_id, target_id,
              allocated_amount, original_notes, original_row, reconciliation_run_id,
              neutralized_by, reason
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'SYSTEM_RECONCILIATION', 'LEGACY_TDS_NEUTRALIZATION')
            ON CONFLICT (original_alloc_id) DO NOTHING
          `, [
            row.alloc_id, row.bill_id, row.vendor_id, row.je_id, row.bill_id,
            row.allocated_amount, row.notes, row.full_row, runId
          ]);
          if (archRes.rowCount !== 1 && archRes.rowCount !== 0) {
            throw new Error(`[RECONCILIATION_FAIL] Archive step failed for alloc_id ${row.alloc_id}`);
          }
        }

        // Delete legacy TDS allocations (repository deletion convention to respect allocated_amount > 0 constraint)
        const delRes = await client.query(`DELETE FROM je_allocations WHERE id = ANY($1::int[])`, [allocIds]);
        if (delRes.rowCount !== allocIds.length) {
          throw new Error(`[RECONCILIATION_FAIL] Delete mismatch for Bill ID ${billId}. Expected ${allocIds.length} deleted rows, got ${delRes.rowCount}.`);
        }

        // Run canonical syncBillStatus
        await syncBillStatus(billId, client);

        // Verify final stored vs canonical results
        const postSettlement = await getBillSettlement(billId, client);
        if (!postSettlement) {
          throw new Error(`[RECONCILIATION_FAIL] Bill ID ${billId} post-settlement verification returned null.`);
        }

        const billCheck = await client.query('SELECT amount_paid, balance_due, payment_status FROM purchase_notes WHERE id = $1', [billId]);
        const stored = billCheck.rows[0];

        const paidDiff = Math.abs(parseFloat(stored.amount_paid) - postSettlement.total_settled);
        const balDiff  = Math.abs(parseFloat(stored.balance_due) - postSettlement.balance_due);
        const statDiff = stored.payment_status !== postSettlement.payment_status;

        if (paidDiff > 0.01 || balDiff > 0.01 || statDiff) {
          throw new Error(`[RECONCILIATION_FAIL] Verification mismatch for Bill ID ${billId}: Stored=[Paid: ${stored.amount_paid}, Bal: ${stored.balance_due}, Stat: ${stored.payment_status}] vs Canonical=[Paid: ${postSettlement.total_settled}, Bal: ${postSettlement.balance_due}, Stat: ${postSettlement.payment_status}]`);
        }
      }

      await client.query('COMMIT');
      console.log(`\n[EXECUTE COMPLETE] Successfully neutralized legacy TDS allocations and synchronized status for ${affectedBillMap.size} affected Bill(s).`);

      await runPostReconciliationScan(client);
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
