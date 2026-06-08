-- ============================================================================
-- Silverstar Grow — Enterprise Partitioning & Archival Strategy
-- For 100M - 1B+ row scalability
-- Apply AFTER perf_indexes.sql
-- ============================================================================

-- ── 1. Partition journal_entries by month ──────────────────────────────────
ALTER TABLE journal_entries RENAME TO journal_entries_old;

CREATE TABLE journal_entries (LIKE journal_entries_old INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) PARTITION BY RANGE (entry_date);

CREATE TABLE journal_entries_2020_01 PARTITION OF journal_entries
  FOR VALUES FROM ('2020-01-01') TO ('2020-02-01');
-- ... generate partitions for all months from 2020-01 to 2030-12
DO $$
DECLARE
  yr INTEGER;
  mo INTEGER;
  start_date DATE;
  end_date DATE;
  partition_name TEXT;
BEGIN
  FOR yr IN 2020..2030 LOOP
    FOR mo IN 1..12 LOOP
      start_date := make_date(yr, mo, 1);
      end_date := make_date(yr, mo + 1, 1);
      partition_name := 'journal_entries_' || to_char(start_date, 'YYYY_MM');
      IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
        EXECUTE format('CREATE TABLE %I PARTITION OF journal_entries FOR VALUES FROM (%L) TO (%L)',
                       partition_name, start_date, end_date);
      END IF;
    END LOOP;
  END LOOP;
END $$;

INSERT INTO journal_entries SELECT * FROM journal_entries_old;
DROP TABLE journal_entries_old;

-- ── 2. Partition je_lines by month (join with journal_entries) ────────────
ALTER TABLE je_lines RENAME TO je_lines_old;

CREATE TABLE je_lines (LIKE je_lines_old INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) PARTITION BY RANGE (entry_date);

-- Pre-create partitions
DO $$
DECLARE
  yr INTEGER;
  mo INTEGER;
  start_date DATE;
  end_date DATE;
  partition_name TEXT;
BEGIN
  FOR yr IN 2020..2030 LOOP
    FOR mo IN 1..12 LOOP
      start_date := make_date(yr, mo, 1);
      end_date := make_date(yr, mo + 1, 1);
      partition_name := 'je_lines_' || to_char(start_date, 'YYYY_MM');
      IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
        EXECUTE format('CREATE TABLE %I PARTITION OF je_lines FOR VALUES FROM (%L) TO (%L)',
                       partition_name, start_date, end_date);
      END IF;
    END LOOP;
  END LOOP;
END $$;

INSERT INTO je_lines SELECT * FROM je_lines_old;
DROP TABLE je_lines_old;

-- ── 3. Partition inventory (lot_movements) by year ────────────────────────
ALTER TABLE lot_movements RENAME TO lot_movements_old;

CREATE TABLE lot_movements (LIKE lot_movements_old INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) PARTITION BY RANGE (created_at);

DO $$
DECLARE
  yr INTEGER;
  start_date DATE;
  end_date DATE;
  partition_name TEXT;
BEGIN
  FOR yr IN 2020..2030 LOOP
    start_date := make_date(yr, 1, 1);
    end_date := make_date(yr + 1, 1, 1);
    partition_name := 'lot_movements_' || yr::TEXT;
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
      EXECUTE format('CREATE TABLE %I PARTITION OF lot_movements FOR VALUES FROM (%L) TO (%L)',
                     partition_name, start_date, end_date);
    END IF;
  END LOOP;
END $$;

INSERT INTO lot_movements SELECT * FROM lot_movements_old;
DROP TABLE lot_movements_old;

-- ── 4. Partition purchase_notes by month ──────────────────────────────────
ALTER TABLE purchase_notes RENAME TO purchase_notes_old;
CREATE TABLE purchase_notes (LIKE purchase_notes_old INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) PARTITION BY RANGE (note_date);
-- ... (same partition creation pattern)
DROP TABLE purchase_notes_old;

-- ── 5. Partition invoices by month ────────────────────────────────────────
ALTER TABLE invoices RENAME TO invoices_old;
CREATE TABLE invoices (LIKE invoices_old INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES) PARTITION BY RANGE (invoice_date);
-- ... (same partition creation pattern)
DROP TABLE invoices_old;

-- ── 6. Materialized view auto-refresh function (enhanced) ─────────────────
CREATE OR REPLACE FUNCTION refresh_materialized_views()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_financial;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trial_balance;
END;
$$ LANGUAGE plpgsql;

-- ── 7. Partition maintenance function ─────────────────────────────────────
CREATE OR REPLACE FUNCTION create_future_partitions(months_ahead INTEGER DEFAULT 6)
RETURNS void AS $$
DECLARE
  target_date DATE;
  partition_name TEXT;
  table_name TEXT;
  tables TEXT[] := ARRAY['journal_entries', 'je_lines', 'purchase_notes', 'invoices'];
  col_name TEXT;
  date_from DATE;
  date_to DATE;
BEGIN
  FOR i IN 0..months_ahead LOOP
    target_date := date_trunc('month', NOW()) + (i || ' months')::INTERVAL;
    date_from := date_trunc('month', target_date)::DATE;
    date_to := (date_trunc('month', target_date) + INTERVAL '1 month')::DATE;
    FOREACH table_name IN ARRAY tables LOOP
      IF table_name IN ('lot_movements') THEN
        -- Yearly partitions for lot_movements
        date_from := date_trunc('year', target_date)::DATE;
        date_to := (date_trunc('year', target_date) + INTERVAL '1 year')::DATE;
        partition_name := table_name || '_' || to_char(date_from, 'YYYY');
      ELSE
        partition_name := table_name || '_' || to_char(date_from, 'YYYY_MM');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
        EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                       partition_name, table_name, date_from, date_to);
        RAISE NOTICE 'Created partition: %', partition_name;
      END IF;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ── 8. Data archival procedure ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION archive_old_data(retention_months INTEGER DEFAULT 60)
RETURNS TABLE(table_name TEXT, archived_rows BIGINT) AS $$
DECLARE
  cutoff_date DATE := date_trunc('month', NOW()) - (retention_months || ' months')::INTERVAL;
  yr INTEGER;
  mo INTEGER;
  arc_table TEXT;
  row_count BIGINT;
BEGIN
  -- Archive je_lines
  FOR yr IN 2018..EXTRACT(YEAR FROM cutoff_date) LOOP
    FOR mo IN 1..12 LOOP
      arc_table := 'je_lines_archived_' || yr::TEXT || '_' || LPAD(mo::TEXT, 2, '0');
      IF EXISTS (SELECT 1 FROM pg_class WHERE relname = arc_table) THEN
        EXECUTE format(
          'WITH moved AS (
             DELETE FROM je_lines_%s_%s RETURNING *
           ) INSERT INTO %I SELECT * FROM moved',
          yr, LPAD(mo::TEXT, 2, '0'), arc_table
        );
        GET DIAGNOSTICS row_count = ROW_COUNT;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
