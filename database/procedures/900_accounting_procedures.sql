CREATE OR REPLACE PROCEDURE post_journal_entry(je_id_param INTEGER)
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE journal_entries
  SET status = 'posted', posted_at = NOW()
  WHERE id = je_id_param AND status = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JE % not found or already posted', je_id_param;
  END IF;
END;
$$;

CREATE OR REPLACE PROCEDURE generate_growth_ledger(cycle_id_param INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  total_cost NUMERIC;
BEGIN
  SELECT COALESCE(SUM(cost), 0) INTO total_cost
  FROM growth_activities WHERE cycle_id = cycle_id_param;
  INSERT INTO journal_entries (je_number, date, description, source_type, source_id, total_debit, total_credit, status)
  VALUES (
    'GR-' || cycle_id_param || '-' || TO_CHAR(NOW(), 'YYYYMMDD'),
    CURRENT_DATE,
    'Growth cycle cost allocation',
    'growth',
    cycle_id_param,
    total_cost,
    total_cost,
    'draft'
  );
END;
$$;

CREATE OR REPLACE PROCEDURE monthly_close(close_date DATE)
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO journal_entries (je_number, date, description, source_type, total_debit, total_credit, status)
  VALUES (
    'CL-' || TO_CHAR(close_date, 'YYYYMM'),
    close_date,
    'Monthly close for ' || TO_CHAR(close_date, 'Month YYYY'),
    'manual',
    0, 0, 'draft'
  );
END;
$$;
