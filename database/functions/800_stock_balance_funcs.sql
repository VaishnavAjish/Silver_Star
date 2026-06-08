CREATE OR REPLACE FUNCTION get_item_stock(item_id_param INTEGER)
RETURNS NUMERIC AS $$
DECLARE
  total_qty NUMERIC;
BEGIN
  SELECT COALESCE(SUM(quantity), 0) INTO total_qty
  FROM stock_batches WHERE item_id = item_id_param;
  RETURN total_qty;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_account_balance(account_id_param INTEGER)
RETURNS NUMERIC AS $$
DECLARE
  bal NUMERIC;
BEGIN
  SELECT balance INTO bal FROM accounts WHERE id = account_id_param;
  RETURN COALESCE(bal, 0);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION is_je_balanced(je_id_param INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  debit_total NUMERIC;
  credit_total NUMERIC;
BEGIN
  SELECT COALESCE(SUM(debit),0), COALESCE(SUM(credit),0)
  INTO debit_total, credit_total
  FROM je_lines WHERE je_id = je_id_param;
  RETURN debit_total = credit_total;
END;
$$ LANGUAGE plpgsql;
