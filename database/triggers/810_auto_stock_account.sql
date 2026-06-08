-- Trigger: Update stock_batches on inventory_transactions INSERT
CREATE OR REPLACE FUNCTION update_stock_on_transaction()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.transaction_type IN ('purchase_receipt', 'transfer_in', 'adjustment_add', 'return') THEN
    INSERT INTO stock_batches (batch_no, item_id, quantity, unit_price, location_id)
    VALUES ('AUTO-' || NEW.id, NEW.item_id, NEW.quantity, NEW.unit_price, NEW.location_id)
    ON CONFLICT DO NOTHING;
  ELSIF NEW.transaction_type IN ('sales_issue', 'transfer_out', 'adjustment_sub') THEN
    UPDATE stock_batches SET quantity = quantity - NEW.quantity
    WHERE item_id = NEW.item_id AND location_id = NEW.location_id AND quantity >= NEW.quantity
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_stock
  AFTER INSERT ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION update_stock_on_transaction();

-- Trigger: Update account balances on je_lines INSERT
CREATE OR REPLACE FUNCTION update_account_balances()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE accounts SET balance = balance + COALESCE(NEW.debit, 0) - COALESCE(NEW.credit, 0)
  WHERE id = NEW.account_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_account_balance
  AFTER INSERT ON je_lines
  FOR EACH ROW EXECUTE FUNCTION update_account_balances();
