-- ==============================================================================
-- ACCOUNTING PHASE 0.5 — FORENSICS (READ-ONLY)
-- Purpose: Investigate the hard-delete blast radius for PAY-1179 and PAY-1240.
-- Run this directly in psql against the production database.
-- ==============================================================================

BEGIN;
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE READ ONLY;
SET statement_timeout = '60s';

-- 1. Identify the corrupt payments
\echo '\n=== CORRUPT PAYMENTS (PAY-1179, PAY-1240) ==='
SELECT p.id, p.doc_number, p.vendor_id, v.name as vendor_name, p.amount, p.status, p.je_id, p.payment_date 
FROM payments p
LEFT JOIN vendors v ON p.vendor_id = v.id
WHERE p.doc_number IN ('PAY-1179', 'PAY-1240');

-- 2. Verify payment allocations (AP side)
\echo '\n=== PAYMENT ALLOCATIONS ==='
SELECT pa.id, pa.payment_id, p.doc_number, pa.purchase_note_id, pn.note_number, pa.amount 
FROM payment_allocations pa
JOIN payments p ON pa.payment_id = p.id
LEFT JOIN purchase_notes pn ON pa.purchase_note_id = pn.id
WHERE p.doc_number IN ('PAY-1179', 'PAY-1240');

-- 3. Verify backing journal entries (GL side)
-- Looking up by je_id AND by source_id to detect unlinked orphans
\echo '\n=== LINKED JOURNAL ENTRIES ==='
SELECT je.id, je.je_number, je.status, je.source_type, je.source_id, je.total_debit, je.total_credit
FROM journal_entries je
WHERE je.id IN (
    SELECT je_id FROM payments WHERE doc_number IN ('PAY-1179', 'PAY-1240') AND je_id IS NOT NULL
) OR (je.source_type = 'payment' AND je.source_id IN (
    SELECT id FROM payments WHERE doc_number IN ('PAY-1179', 'PAY-1240')
));

-- 4. Verify GL Lines (to see if only header was deleted or lines too)
\echo '\n=== LINKED JOURNAL LINES ==='
SELECT jl.id, jl.je_id, je.je_number, jl.account_id, a.name as account_name, jl.debit, jl.credit
FROM je_lines jl
JOIN journal_entries je ON jl.je_id = je.id
JOIN accounts a ON jl.account_id = a.id
WHERE je.id IN (
    SELECT je_id FROM payments WHERE doc_number IN ('PAY-1179', 'PAY-1240') AND je_id IS NOT NULL
) OR (je.source_type = 'payment' AND je.source_id IN (
    SELECT id FROM payments WHERE doc_number IN ('PAY-1179', 'PAY-1240')
));

-- 5. JE Allocations (to see if TDS/Bill allocations exist)
\echo '\n=== LINKED JE ALLOCATIONS ==='
SELECT ja.id, ja.je_id, je.je_number, ja.target_type, ja.target_id, ja.allocated_amount
FROM je_allocations ja
JOIN journal_entries je ON ja.je_id = je.id
WHERE je.id IN (
    SELECT je_id FROM payments WHERE doc_number IN ('PAY-1179', 'PAY-1240') AND je_id IS NOT NULL
) OR (je.source_type = 'payment' AND je.source_id IN (
    SELECT id FROM payments WHERE doc_number IN ('PAY-1179', 'PAY-1240')
));

-- 6. Blast radius calculation (Vendor Balance Discrepancy)
\echo '\n=== VENDOR BALANCE DISCREPANCIES ==='
WITH vendor_ids AS (
    SELECT DISTINCT vendor_id FROM payments WHERE doc_number IN ('PAY-1179', 'PAY-1240')
),
actual_gl AS (
    SELECT v.id as vendor_id, COALESCE(SUM(jl.credit) - SUM(jl.debit), 0) as ap_balance
    FROM vendor_ids v
    JOIN accounts a ON a.entity_type = 'vendor' AND a.entity_id = v.vendor_id
    LEFT JOIN je_lines jl ON jl.account_id = a.id
    LEFT JOIN journal_entries je ON jl.je_id = je.id AND je.status = 'posted'
    GROUP BY v.id
),
expected_ap AS (
    SELECT v.id as vendor_id, 
           (
             COALESCE((SELECT SUM(grand_total) FROM purchase_notes WHERE vendor_id = v.id AND status != 'CANCELLED'), 0)
             - COALESCE((SELECT SUM(amount) FROM payments WHERE vendor_id = v.id AND status IN ('COMPLETED', 'PARTIAL')), 0)
             - COALESCE((SELECT SUM(amount) FROM debit_notes WHERE vendor_id = v.id AND status != 'CANCELLED'), 0)
           ) as expected_balance
    FROM vendor_ids v
)
SELECT e.vendor_id, v.name, e.expected_balance, g.ap_balance, 
       (g.ap_balance - e.expected_balance) as discrepancy
FROM expected_ap e
JOIN actual_gl g ON e.vendor_id = g.vendor_id
JOIN vendors v ON e.vendor_id = v.id;

ROLLBACK;
