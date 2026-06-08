-- ============================================================
-- SILVERSTAR GROW - DEV ONLY transactional reset
-- Does NOT delete masters: accounts, items, customers, vendors, etc.
-- ============================================================

BEGIN;

-- Break document -> journal references before clearing journals.
UPDATE purchase_notes SET je_id = NULL WHERE to_regclass('purchase_notes') IS NOT NULL;
UPDATE invoices SET je_id = NULL, cogs_je_id = NULL WHERE to_regclass('invoices') IS NOT NULL;
UPDATE expenses SET je_id = NULL WHERE to_regclass('expenses') IS NOT NULL;
UPDATE payments SET je_id = NULL WHERE to_regclass('payments') IS NOT NULL;
UPDATE receipts SET je_id = NULL WHERE to_regclass('receipts') IS NOT NULL;
UPDATE process_transactions SET je_id = NULL WHERE to_regclass('process_transactions') IS NOT NULL;
UPDATE rough_growth SET je_id = NULL WHERE to_regclass('rough_growth') IS NOT NULL;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'receipt_allocations',
    'payment_allocations',
    'receipts',
    'payments',
    'invoice_lines',
    'invoices',
    'purchase_note_lines',
    'purchase_notes',
    'expenses',
    'rough_growth_lines',
    'rough_growth',
    'process_transaction_lines',
    'process_transactions',
    'lot_movement_children',
    'lot_movement_parents',
    'lot_movements',
    'inventory_closing_override',
    'inventory_opening',
    'inventory',
    'je_lines',
    'journal_entries'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(t) IS NOT NULL THEN
      EXECUTE format('DELETE FROM %I', t);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  s text;
  seqs text[] := ARRAY[
    'je_seq','pn_seq','exp_seq','ps_seq','pr_seq','gr_seq','rd_seq',
    'inv_seq','pay_seq','rct_seq','lm_seq'
  ];
BEGIN
  FOREACH s IN ARRAY seqs LOOP
    IF to_regclass(s) IS NOT NULL THEN
      EXECUTE format('ALTER SEQUENCE %I RESTART WITH 1', s);
    END IF;
  END LOOP;
END $$;

UPDATE accounts SET balance = 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'items' AND column_name = 'quantity_on_hand'
  ) THEN
    UPDATE items
    SET quantity_on_hand = 0,
        avg_cost = 0,
        last_purchase_cost = 0,
        inventory_value = 0;
  END IF;
END $$;

COMMIT;
