#!/usr/bin/env node
'use strict';

/**
 * ACCOUNTING PHASE 1A — Historical Orphan Payment Reconciliation runner.
 *
 * Restricted administrative CLI around
 * services/orphanPaymentReconciliation.js. There is deliberately NO UI
 * and NO public API for this repair: it is invoked explicitly, after
 * human review of the dry-run evidence.
 *
 * Dry-run (default — ZERO writes, wrapped in a READ ONLY transaction):
 *   node scripts/reconcileOrphanedPayment.js \
 *     --payment-id 180 --payment PAY-1179 \
 *     --expected-je 605 --expected-amount 43932.00 --dry-run
 *
 * Apply (every expectation is re-verified inside the transaction;
 * aborts on any mismatch; GL mutations are impossible by construction):
 *   node scripts/reconcileOrphanedPayment.js \
 *     --payment-id 180 --payment PAY-1179 \
 *     --expected-je 605 --expected-amount 43932.00 \
 *     --apply --actor-id <users.id> \
 *     --reason "Historical orphan repair approved by <owner> on <date>"
 *
 * The script never hard-codes payment ids or references — the operator
 * must supply every expectation (Stage 16 two-person rule).
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dotenvPath = fs.existsSync(path.join(__dirname, '../.env'))
  ? path.join(__dirname, '../.env')
  : path.join(__dirname, '../../server/.env');
require('dotenv').config({ path: dotenvPath });

const pool = require('../db/pool');
const {
  reconcileOrphanedPayment,
  formatReport,
  CODES,
} = require('../services/orphanPaymentReconciliation');

function parseArgs(argv) {
  const args = { dryRun: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--payment-id':      args.paymentId = next(); break;
      case '--payment':         args.expectedReference = next(); break;
      case '--expected-je':     args.expectedMissingJeId = next(); break;
      case '--expected-amount': args.expectedAmount = next(); break;
      case '--reason':          args.reason = next(); break;
      case '--actor-id':        args.actorId = next(); break;
      case '--dry-run':         args.dryRun = true; break;
      case '--apply':           args.apply = true; break;
      case '--help':            args.help = true; break;
      default:
        console.error(`Unknown argument: ${a}`);
        args.help = true;
    }
  }
  return args;
}

function usage() {
  console.log(`
Usage:
  node scripts/reconcileOrphanedPayment.js
    --payment-id <payments.id>          (required)
    --payment <doc_number>              (required, e.g. PAY-1179)
    --expected-je <missing je id>       (required)
    --expected-amount <decimal>         (required, e.g. 43932.00)
    [--dry-run]                         (default; zero writes)
    [--apply --reason "<why>" [--actor-id <users.id>]]
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); process.exit(1); }

  const missing = [];
  if (!args.paymentId) missing.push('--payment-id');
  if (!args.expectedReference) missing.push('--payment');
  if (!args.expectedMissingJeId) missing.push('--expected-je');
  if (!args.expectedAmount) missing.push('--expected-amount');
  if (args.apply && !args.reason) missing.push('--reason (mandatory with --apply)');
  if (missing.length) {
    console.error(`Missing required argument(s): ${missing.join(', ')}`);
    usage();
    process.exit(1);
  }

  const dryRun = !args.apply;
  const runId = crypto.randomUUID();

  console.log(`[Orphan Payment Reconciliation] run ${runId}`);
  console.log(`Mode: ${dryRun ? 'DRY-RUN (zero writes)' : 'APPLY (transactional)'}`);
  if (!dryRun) {
    console.log('APPLY MODE — every expectation is re-verified under row locks; any mismatch aborts with full rollback.');
  }

  try {
    const result = await reconcileOrphanedPayment({
      paymentId: args.paymentId,
      expectedReference: args.expectedReference,
      expectedAmount: args.expectedAmount,
      expectedMissingJeId: args.expectedMissingJeId,
      actorId: args.actorId ? parseInt(args.actorId, 10) : null,
      reason: args.reason || '',
      dryRun,
      runId,
    });

    console.log('');
    console.log(formatReport(result));

    if (result.code === CODES.ALREADY_RECONCILED) {
      console.log('\nALREADY_RECONCILED — no changes were made.');
      process.exit(0);
    }
    process.exit(result.ok ? 0 : 2);
  } catch (err) {
    console.error('\n[Orphan Payment Reconciliation] FAILED — full rollback performed.');
    console.error(err.code ? `${err.code}: ${err.message}` : err);
    process.exit(1);
  } finally {
    try { await pool.primaryPool.end(); } catch (_) {}
  }
}

main();
