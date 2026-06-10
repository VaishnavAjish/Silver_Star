--
-- PostgreSQL database dump
--

\restrict yGT90xFvzKwyPPQo5SaXGMcYlePwITxkKajnchbpz9cyblCAmKa0hfF9hagE3ql

-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO postgres;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: postgres
--

COMMENT ON SCHEMA public IS '';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: account_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.account_status AS ENUM (
    'active',
    'inactive'
);


ALTER TYPE public.account_status OWNER TO postgres;

--
-- Name: account_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.account_type AS ENUM (
    'asset',
    'liability',
    'equity',
    'revenue',
    'expense'
);


ALTER TYPE public.account_type OWNER TO postgres;

--
-- Name: doc_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.doc_status AS ENUM (
    'draft',
    'open',
    'closed',
    'cancelled'
);


ALTER TYPE public.doc_status OWNER TO postgres;

--
-- Name: fixed_asset_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.fixed_asset_status AS ENUM (
    'active',
    'disposed',
    'written_off'
);


ALTER TYPE public.fixed_asset_status OWNER TO postgres;

--
-- Name: item_category; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.item_category AS ENUM (
    'seed',
    'gas',
    'consumable',
    'rough',
    'growth_run'
);


ALTER TYPE public.item_category OWNER TO postgres;

--
-- Name: item_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.item_type AS ENUM (
    'raw_material',
    'finished_good'
);


ALTER TYPE public.item_type OWNER TO postgres;

--
-- Name: je_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.je_status AS ENUM (
    'draft',
    'posted',
    'cancelled'
);


ALTER TYPE public.je_status OWNER TO postgres;

--
-- Name: lot_movement_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.lot_movement_type AS ENUM (
    'split',
    'mix',
    'transfer'
);


ALTER TYPE public.lot_movement_type OWNER TO postgres;

--
-- Name: machine_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.machine_status AS ENUM (
    'running',
    'maintenance',
    'idle',
    'hold',
    'breakdown',
    'completed',
    'cleaning',
    'awaiting_output'
);


ALTER TYPE public.machine_status OWNER TO postgres;

--
-- Name: master_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.master_status AS ENUM (
    'active',
    'inactive'
);


ALTER TYPE public.master_status OWNER TO postgres;

--
-- Name: process_trs_type; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.process_trs_type AS ENUM (
    'send',
    'return'
);


ALTER TYPE public.process_trs_type OWNER TO postgres;

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.user_role AS ENUM (
    'admin',
    'operator',
    'viewer',
    'super_admin'
);


ALTER TYPE public.user_role OWNER TO postgres;

--
-- Name: vendor_category; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.vendor_category AS ENUM (
    'seed',
    'gas',
    'consumable',
    'general'
);


ALTER TYPE public.vendor_category OWNER TO postgres;

--
-- Name: archive_old_data(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.archive_old_data(retention_months integer DEFAULT 60) RETURNS TABLE(table_name text, archived_rows bigint)
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.archive_old_data(retention_months integer) OWNER TO postgres;

--
-- Name: check_lot_movement_balance(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.check_lot_movement_balance() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_p_val  NUMERIC;
  v_c_val  NUMERIC;
  v_p_qty  NUMERIC;
  v_c_qty  NUMERIC;
BEGIN
  SELECT COALESCE(SUM(quantity_consumed * cost_per_unit), 0),
         COALESCE(SUM(quantity_consumed), 0)
  INTO v_p_val, v_p_qty
  FROM lot_movement_parents
  WHERE movement_id = NEW.movement_id;

  SELECT COALESCE(SUM(quantity * cost_per_unit), 0),
         COALESCE(SUM(quantity), 0)
  INTO v_c_val, v_c_qty
  FROM lot_movement_children
  WHERE movement_id = NEW.movement_id;

  -- Only check once both sides are fully populated
  IF v_p_qty > 0 AND v_c_qty > 0 THEN
    IF ABS(v_p_qty - v_c_qty) > 0.0001 THEN
      RAISE EXCEPTION
        'Lot movement % quantity mismatch: parents=% children=%',
        NEW.movement_id, v_p_qty, v_c_qty;
    END IF;
    -- ₹0.01 tolerance absorbs weighted-average rounding
    IF ABS(v_p_val - v_c_val) > 0.01 THEN
      RAISE EXCEPTION
        'Lot movement % value mismatch: parents=% children=%',
        NEW.movement_id, v_p_val, v_c_val;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.check_lot_movement_balance() OWNER TO postgres;

--
-- Name: create_future_partitions(integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_future_partitions(months_ahead integer DEFAULT 6) RETURNS void
    LANGUAGE plpgsql
    AS $$
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
$$;


ALTER FUNCTION public.create_future_partitions(months_ahead integer) OWNER TO postgres;

--
-- Name: emit_table_change(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.emit_table_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  payload JSONB;
  channel TEXT;
BEGIN
  channel := TG_TABLE_NAME || '_' || TG_OP;
  payload := jsonb_build_object(
    'table',    TG_TABLE_NAME,
    'schema',   TG_TABLE_SCHEMA,
    'operation', TG_OP,
    'timestamp', NOW(),
    'old',      CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN row_to_json(OLD)::jsonb ELSE NULL END,
    'new',      CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN row_to_json(NEW)::jsonb ELSE NULL END
  );
  PERFORM pg_notify(channel, payload::text);
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION public.emit_table_change() OWNER TO postgres;

--
-- Name: purge_old_events(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.purge_old_events() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  deleted INTEGER;
BEGIN
  WITH del AS (
    DELETE FROM sys_event_outbox
    WHERE created_at < NOW() - INTERVAL '24 hours'
    RETURNING id
  )
  SELECT COUNT(*) INTO deleted FROM del;
  RETURN deleted;
END;
$$;


ALTER FUNCTION public.purge_old_events() OWNER TO postgres;

--
-- Name: refresh_materialized_views(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.refresh_materialized_views() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_dashboard_financial;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trial_balance;
END;
$$;


ALTER FUNCTION public.refresh_materialized_views() OWNER TO postgres;

--
-- Name: update_timestamp(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_timestamp() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_timestamp() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: accounts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.accounts (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(150) NOT NULL,
    type public.account_type NOT NULL,
    parent_id integer,
    is_group boolean DEFAULT false,
    currency character varying(3) DEFAULT 'INR'::character varying,
    balance numeric(15,2) DEFAULT 0.00,
    status public.account_status DEFAULT 'active'::public.account_status,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    sub_type character varying(50),
    level integer DEFAULT 1,
    path text,
    is_posting boolean DEFAULT true
);


ALTER TABLE public.accounts OWNER TO postgres;

--
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.accounts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.accounts_id_seq OWNER TO postgres;

--
-- Name: accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.accounts_id_seq OWNED BY public.accounts.id;


--
-- Name: api_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.api_logs (
    id integer NOT NULL,
    method character varying(10) NOT NULL,
    endpoint character varying(255) NOT NULL,
    status_code integer,
    response_time_ms integer,
    ip_address character varying(45),
    user_id integer,
    request_body text,
    error_message text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.api_logs OWNER TO postgres;

--
-- Name: api_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.api_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.api_logs_id_seq OWNER TO postgres;

--
-- Name: api_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.api_logs_id_seq OWNED BY public.api_logs.id;


--
-- Name: asset_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.asset_templates (
    id integer NOT NULL,
    code character varying(30) NOT NULL,
    name character varying(200) NOT NULL,
    category_id integer NOT NULL,
    default_model_no character varying(100),
    default_brand character varying(100),
    default_manufacturer character varying(150),
    default_uom_id integer,
    default_useful_life numeric(5,2),
    default_depr_rate numeric(6,2),
    description text,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT asset_templates_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character varying])::text[])))
);


ALTER TABLE public.asset_templates OWNER TO postgres;

--
-- Name: asset_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.asset_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.asset_templates_id_seq OWNER TO postgres;

--
-- Name: asset_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.asset_templates_id_seq OWNED BY public.asset_templates.id;


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_log (
    id integer NOT NULL,
    table_name character varying(50) NOT NULL,
    record_id integer NOT NULL,
    action character varying(10) NOT NULL,
    old_data jsonb,
    new_data jsonb,
    changed_by integer,
    changed_at timestamp with time zone DEFAULT now(),
    CONSTRAINT audit_log_action_check CHECK (((action)::text = ANY ((ARRAY['INSERT'::character varying, 'UPDATE'::character varying, 'DELETE'::character varying])::text[])))
);


ALTER TABLE public.audit_log OWNER TO postgres;

--
-- Name: audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.audit_log_id_seq OWNER TO postgres;

--
-- Name: audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.audit_log_id_seq OWNED BY public.audit_log.id;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_logs (
    id integer NOT NULL,
    "timestamp" timestamp without time zone DEFAULT now(),
    user_id integer,
    action text NOT NULL,
    table_name text,
    record_id bigint,
    old_values text,
    new_values text,
    ip_address text,
    user_agent text,
    duration_ms integer DEFAULT 0,
    status_code integer DEFAULT 200
);


ALTER TABLE public.audit_logs OWNER TO postgres;

--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.audit_logs_id_seq OWNER TO postgres;

--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: bank_deposit_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bank_deposit_lines (
    id integer NOT NULL,
    deposit_id integer NOT NULL,
    party_name character varying(150),
    account_id integer NOT NULL,
    description text,
    amount numeric(15,2) NOT NULL,
    payment_method character varying(50),
    ref_no character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    received_from_type character varying(20),
    received_from_id integer,
    CONSTRAINT bank_deposit_lines_amount_check CHECK ((amount > (0)::numeric))
);


ALTER TABLE public.bank_deposit_lines OWNER TO postgres;

--
-- Name: COLUMN bank_deposit_lines.received_from_type; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bank_deposit_lines.received_from_type IS 'customer | vendor | other';


--
-- Name: COLUMN bank_deposit_lines.received_from_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.bank_deposit_lines.received_from_id IS 'FK to customers.id or vendors.id depending on type';


--
-- Name: bank_deposit_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bank_deposit_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bank_deposit_lines_id_seq OWNER TO postgres;

--
-- Name: bank_deposit_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bank_deposit_lines_id_seq OWNED BY public.bank_deposit_lines.id;


--
-- Name: bank_deposits; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bank_deposits (
    id integer NOT NULL,
    date date NOT NULL,
    bank_account_id integer NOT NULL,
    total_amount numeric(15,2) NOT NULL,
    memo text,
    je_id integer,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    status character varying(20) DEFAULT 'posted'::character varying NOT NULL,
    reverse_je_id integer,
    doc_number character varying(20),
    CONSTRAINT bank_deposits_total_amount_check CHECK ((total_amount > (0)::numeric))
);


ALTER TABLE public.bank_deposits OWNER TO postgres;

--
-- Name: bank_deposits_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bank_deposits_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bank_deposits_id_seq OWNER TO postgres;

--
-- Name: bank_deposits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bank_deposits_id_seq OWNED BY public.bank_deposits.id;


--
-- Name: bank_reconciliation; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bank_reconciliation (
    id integer NOT NULL,
    account_id integer NOT NULL,
    statement_date date NOT NULL,
    statement_balance numeric(14,2) DEFAULT 0,
    created_by integer,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.bank_reconciliation OWNER TO postgres;

--
-- Name: bank_reconciliation_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bank_reconciliation_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bank_reconciliation_id_seq OWNER TO postgres;

--
-- Name: bank_reconciliation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bank_reconciliation_id_seq OWNED BY public.bank_reconciliation.id;


--
-- Name: bank_reconciliation_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.bank_reconciliation_lines (
    id integer NOT NULL,
    reconciliation_id integer NOT NULL,
    je_id integer,
    system_amount numeric(14,2) DEFAULT 0,
    bank_amount numeric(14,2) DEFAULT 0,
    match_status character varying(20) DEFAULT 'unmatched'::character varying,
    bank_date date,
    bank_ref text
);


ALTER TABLE public.bank_reconciliation_lines OWNER TO postgres;

--
-- Name: bank_reconciliation_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.bank_reconciliation_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.bank_reconciliation_lines_id_seq OWNER TO postgres;

--
-- Name: bank_reconciliation_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.bank_reconciliation_lines_id_seq OWNED BY public.bank_reconciliation_lines.id;


--
-- Name: code_sequences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.code_sequences (
    id integer NOT NULL,
    entity_type character varying(50) NOT NULL,
    prefix character varying(20) NOT NULL,
    separator character(1) DEFAULT '-'::bpchar NOT NULL,
    period_scope character varying(10) DEFAULT 'none'::character varying NOT NULL,
    padding integer DEFAULT 6 NOT NULL,
    next_value bigint DEFAULT 1 NOT NULL,
    format_pattern character varying(100) DEFAULT 'PREFIX-SEQ'::character varying NOT NULL,
    editable_policy character varying(20) DEFAULT 'auto'::character varying NOT NULL,
    description character varying(200),
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT code_sequences_editable_policy_check CHECK (((editable_policy)::text = ANY (ARRAY[('auto'::character varying)::text, ('user_override'::character varying)::text]))),
    CONSTRAINT code_sequences_format_pattern_check CHECK (((format_pattern)::text = ANY (ARRAY[('PREFIX-SEQ'::character varying)::text, ('PREFIX-YYYYMM-SEQ'::character varying)::text, ('PREFIX-YYYY-SEQ'::character varying)::text]))),
    CONSTRAINT code_sequences_next_value_check CHECK ((next_value >= 1)),
    CONSTRAINT code_sequences_padding_check CHECK (((padding >= 0) AND (padding <= 10))),
    CONSTRAINT code_sequences_period_scope_check CHECK (((period_scope)::text = ANY (ARRAY[('none'::character varying)::text, ('year'::character varying)::text, ('month'::character varying)::text])))
);


ALTER TABLE public.code_sequences OWNER TO postgres;

--
-- Name: code_sequences_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.code_sequences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.code_sequences_id_seq OWNER TO postgres;

--
-- Name: code_sequences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.code_sequences_id_seq OWNED BY public.code_sequences.id;


--
-- Name: cost_centers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.cost_centers (
    id integer NOT NULL,
    name text NOT NULL,
    code text,
    status text DEFAULT 'active'::text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.cost_centers OWNER TO postgres;

--
-- Name: cost_centers_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.cost_centers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.cost_centers_id_seq OWNER TO postgres;

--
-- Name: cost_centers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.cost_centers_id_seq OWNED BY public.cost_centers.id;


--
-- Name: customer_advances; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customer_advances (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    receipt_id integer NOT NULL,
    amount numeric(15,2) NOT NULL,
    remaining_amount numeric(15,2) NOT NULL,
    status character varying(20) DEFAULT 'OPEN'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT customer_advances_amount_check CHECK ((amount > (0)::numeric))
);


ALTER TABLE public.customer_advances OWNER TO postgres;

--
-- Name: customer_advances_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.customer_advances_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customer_advances_id_seq OWNER TO postgres;

--
-- Name: customer_advances_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.customer_advances_id_seq OWNED BY public.customer_advances.id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(150) NOT NULL,
    contact_person character varying(100),
    phone character varying(20),
    email character varying(150),
    address text,
    city character varying(50),
    state character varying(50),
    gstin character varying(22),
    pan character varying(12),
    payment_term character varying(30) DEFAULT '30 Days'::character varying,
    credit_limit numeric(15,2) DEFAULT 0,
    outstanding numeric(15,2) DEFAULT 0,
    status public.master_status DEFAULT 'active'::public.master_status,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    account_id integer
);


ALTER TABLE public.customers OWNER TO postgres;

--
-- Name: COLUMN customers.account_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.customers.account_id IS 'Optional AR sub-ledger account in the chart of accounts (accounts.id)';


--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customers_id_seq OWNER TO postgres;

--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: departments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.departments (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    head character varying(100),
    location_id integer,
    staff_count integer DEFAULT 0,
    status public.master_status DEFAULT 'active'::public.master_status,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.departments OWNER TO postgres;

--
-- Name: departments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.departments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.departments_id_seq OWNER TO postgres;

--
-- Name: departments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.departments_id_seq OWNED BY public.departments.id;


--
-- Name: depreciation_run_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.depreciation_run_lines (
    id integer NOT NULL,
    run_id integer NOT NULL,
    fixed_asset_id integer NOT NULL,
    opening_wdv numeric(15,2) NOT NULL,
    depreciation_amount numeric(15,2) NOT NULL,
    closing_wdv numeric(15,2) NOT NULL,
    days_in_period integer NOT NULL,
    CONSTRAINT depreciation_run_lines_depreciation_amount_check CHECK ((depreciation_amount >= (0)::numeric))
);


ALTER TABLE public.depreciation_run_lines OWNER TO postgres;

--
-- Name: depreciation_run_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.depreciation_run_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.depreciation_run_lines_id_seq OWNER TO postgres;

--
-- Name: depreciation_run_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.depreciation_run_lines_id_seq OWNED BY public.depreciation_run_lines.id;


--
-- Name: depreciation_runs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.depreciation_runs (
    id integer NOT NULL,
    run_number character varying(20) NOT NULL,
    period_from date NOT NULL,
    period_to date NOT NULL,
    je_id integer,
    total_amount numeric(15,2) DEFAULT 0 NOT NULL,
    status character varying(10) DEFAULT 'draft'::character varying NOT NULL,
    remarks text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT depreciation_runs_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'posted'::character varying, 'cancelled'::character varying])::text[]))),
    CONSTRAINT period_valid CHECK ((period_to >= period_from))
);


ALTER TABLE public.depreciation_runs OWNER TO postgres;

--
-- Name: depreciation_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.depreciation_runs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.depreciation_runs_id_seq OWNER TO postgres;

--
-- Name: depreciation_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.depreciation_runs_id_seq OWNED BY public.depreciation_runs.id;


--
-- Name: dr_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.dr_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.dr_seq OWNER TO postgres;

--
-- Name: exp_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.exp_seq
    START WITH 100
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.exp_seq OWNER TO postgres;

--
-- Name: expense_allocations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.expense_allocations (
    id integer NOT NULL,
    expense_id integer NOT NULL,
    purchase_note_id integer NOT NULL,
    amount numeric(15,2) NOT NULL,
    allocated_date date,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT expense_allocations_amount_check CHECK ((amount > (0)::numeric))
);


ALTER TABLE public.expense_allocations OWNER TO postgres;

--
-- Name: expense_allocations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.expense_allocations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.expense_allocations_id_seq OWNER TO postgres;

--
-- Name: expense_allocations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.expense_allocations_id_seq OWNED BY public.expense_allocations.id;


--
-- Name: expense_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.expense_categories (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    gl_account_id bigint,
    monthly_budget numeric(12,2) DEFAULT 0,
    status public.master_status DEFAULT 'active'::public.master_status,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.expense_categories OWNER TO postgres;

--
-- Name: expense_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.expense_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.expense_categories_id_seq OWNER TO postgres;

--
-- Name: expense_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.expense_categories_id_seq OWNED BY public.expense_categories.id;


--
-- Name: expense_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.expense_lines (
    id integer NOT NULL,
    expense_id integer NOT NULL,
    seq integer DEFAULT 1 NOT NULL,
    category_id integer,
    description text,
    department_id integer,
    cost_center_id integer,
    amount numeric(14,2) DEFAULT 0 NOT NULL,
    gl_account_id integer,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.expense_lines OWNER TO postgres;

--
-- Name: expense_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.expense_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.expense_lines_id_seq OWNER TO postgres;

--
-- Name: expense_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.expense_lines_id_seq OWNED BY public.expense_lines.id;


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.expenses (
    id integer NOT NULL,
    doc_number character varying(20) NOT NULL,
    date date NOT NULL,
    category_id integer,
    description text,
    amount numeric(15,2) NOT NULL,
    paid_via character varying(30),
    payment_account_id integer,
    reference_no character varying(50),
    department_id integer,
    je_id integer,
    status character varying(20) DEFAULT 'PENDING'::character varying,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    vendor_id integer,
    payment_mode character varying(50) DEFAULT 'Bank Transfer'::character varying,
    memo text
);


ALTER TABLE public.expenses OWNER TO postgres;

--
-- Name: expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.expenses_id_seq OWNER TO postgres;

--
-- Name: expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.expenses_id_seq OWNED BY public.expenses.id;


--
-- Name: fa_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fa_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.fa_seq OWNER TO postgres;

--
-- Name: fixed_asset_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fixed_asset_categories (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    depreciation_rate_pct numeric(5,2) NOT NULL,
    depreciation_method character varying(10) DEFAULT 'SLM'::character varying NOT NULL,
    useful_life_years integer,
    gl_asset_account_id integer NOT NULL,
    gl_accum_depr_account_id integer NOT NULL,
    gl_depr_expense_account_id integer NOT NULL,
    status public.master_status DEFAULT 'active'::public.master_status,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT fixed_asset_categories_depreciation_method_check CHECK (((depreciation_method)::text = ANY ((ARRAY['SLM'::character varying, 'WDV'::character varying])::text[]))),
    CONSTRAINT fixed_asset_categories_depreciation_rate_pct_check CHECK (((depreciation_rate_pct >= (0)::numeric) AND (depreciation_rate_pct <= (100)::numeric)))
);


ALTER TABLE public.fixed_asset_categories OWNER TO postgres;

--
-- Name: fixed_asset_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fixed_asset_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.fixed_asset_categories_id_seq OWNER TO postgres;

--
-- Name: fixed_asset_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fixed_asset_categories_id_seq OWNED BY public.fixed_asset_categories.id;


--
-- Name: fixed_asset_gst_ledger; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fixed_asset_gst_ledger (
    id integer NOT NULL,
    fixed_asset_id integer NOT NULL,
    vendor_id integer,
    invoice_no character varying(50),
    invoice_date date,
    taxable_value numeric(15,2) DEFAULT 0 NOT NULL,
    cgst_amount numeric(15,2) DEFAULT 0 NOT NULL,
    sgst_amount numeric(15,2) DEFAULT 0 NOT NULL,
    igst_amount numeric(15,2) DEFAULT 0 NOT NULL,
    gst_claimable_amount numeric(15,2) DEFAULT 0 NOT NULL,
    gst_non_claimable_amount numeric(15,2) DEFAULT 0 NOT NULL,
    total_invoice_value numeric(15,2) DEFAULT 0 NOT NULL,
    treatment character varying(20) DEFAULT 'non_claimable'::character varying NOT NULL,
    remarks text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT fixed_asset_gst_ledger_cgst_amount_check CHECK ((cgst_amount >= (0)::numeric)),
    CONSTRAINT fixed_asset_gst_ledger_gst_claimable_amount_check CHECK ((gst_claimable_amount >= (0)::numeric)),
    CONSTRAINT fixed_asset_gst_ledger_gst_non_claimable_amount_check CHECK ((gst_non_claimable_amount >= (0)::numeric)),
    CONSTRAINT fixed_asset_gst_ledger_igst_amount_check CHECK ((igst_amount >= (0)::numeric)),
    CONSTRAINT fixed_asset_gst_ledger_sgst_amount_check CHECK ((sgst_amount >= (0)::numeric)),
    CONSTRAINT fixed_asset_gst_ledger_taxable_value_check CHECK ((taxable_value >= (0)::numeric)),
    CONSTRAINT fixed_asset_gst_ledger_total_invoice_value_check CHECK ((total_invoice_value >= (0)::numeric)),
    CONSTRAINT fixed_asset_gst_ledger_treatment_check CHECK (((treatment)::text = ANY (ARRAY[('claimable'::character varying)::text, ('non_claimable'::character varying)::text, ('partial'::character varying)::text])))
);


ALTER TABLE public.fixed_asset_gst_ledger OWNER TO postgres;

--
-- Name: fixed_asset_gst_ledger_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fixed_asset_gst_ledger_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.fixed_asset_gst_ledger_id_seq OWNER TO postgres;

--
-- Name: fixed_asset_gst_ledger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fixed_asset_gst_ledger_id_seq OWNED BY public.fixed_asset_gst_ledger.id;


--
-- Name: fixed_assets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.fixed_assets (
    id integer NOT NULL,
    asset_code character varying(30) NOT NULL,
    asset_name character varying(150) NOT NULL,
    category_id integer NOT NULL,
    purchase_note_id integer,
    purchase_note_line_id integer,
    vendor_id integer,
    location_id integer,
    department_id integer,
    purchase_date date NOT NULL,
    in_service_date date NOT NULL,
    invoice_no character varying(50),
    invoice_date date,
    taxable_value numeric(15,2) DEFAULT 0,
    gst_rate numeric(5,2) DEFAULT 0,
    cgst_amount numeric(15,2) DEFAULT 0,
    sgst_amount numeric(15,2) DEFAULT 0,
    igst_amount numeric(15,2) DEFAULT 0,
    gst_claimable_amount numeric(15,2) DEFAULT 0,
    gst_non_claimable_amount numeric(15,2) DEFAULT 0,
    gst_treatment character varying(20) DEFAULT 'non_claimable'::character varying,
    total_invoice_value numeric(15,2) DEFAULT 0,
    purchase_cost numeric(15,2) NOT NULL,
    salvage_value numeric(15,2) DEFAULT 0,
    accumulated_depreciation numeric(15,2) DEFAULT 0 NOT NULL,
    status public.fixed_asset_status DEFAULT 'active'::public.fixed_asset_status NOT NULL,
    disposal_date date,
    disposal_value numeric(15,2),
    remarks text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    serial_no character varying(100),
    model_no character varying(100),
    brand character varying(100),
    manufacturer character varying(150),
    qty numeric(10,2) DEFAULT 1,
    uom_id integer,
    asset_tag character varying(50),
    condition character varying(20) DEFAULT 'new'::character varying,
    warranty_expiry date,
    installation_date date,
    custodian character varying(150),
    template_id integer,
    CONSTRAINT fixed_assets_cgst_amount_check CHECK ((cgst_amount >= (0)::numeric)),
    CONSTRAINT fixed_assets_gst_claimable_amount_check CHECK ((gst_claimable_amount >= (0)::numeric)),
    CONSTRAINT fixed_assets_gst_non_claimable_amount_check CHECK ((gst_non_claimable_amount >= (0)::numeric)),
    CONSTRAINT fixed_assets_gst_rate_check CHECK ((gst_rate >= (0)::numeric)),
    CONSTRAINT fixed_assets_gst_treatment_check CHECK (((gst_treatment)::text = ANY ((ARRAY['claimable'::character varying, 'non_claimable'::character varying, 'partial'::character varying])::text[]))),
    CONSTRAINT fixed_assets_igst_amount_check CHECK ((igst_amount >= (0)::numeric)),
    CONSTRAINT fixed_assets_purchase_cost_check CHECK ((purchase_cost >= (0)::numeric)),
    CONSTRAINT fixed_assets_salvage_value_check CHECK ((salvage_value >= (0)::numeric)),
    CONSTRAINT fixed_assets_sgst_amount_check CHECK ((sgst_amount >= (0)::numeric)),
    CONSTRAINT fixed_assets_taxable_value_check CHECK ((taxable_value >= (0)::numeric)),
    CONSTRAINT fixed_assets_total_invoice_value_check CHECK ((total_invoice_value >= (0)::numeric)),
    CONSTRAINT salvage_lte_cost CHECK ((salvage_value <= purchase_cost))
);


ALTER TABLE public.fixed_assets OWNER TO postgres;

--
-- Name: fixed_assets_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.fixed_assets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.fixed_assets_id_seq OWNER TO postgres;

--
-- Name: fixed_assets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.fixed_assets_id_seq OWNED BY public.fixed_assets.id;


--
-- Name: gr_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.gr_seq
    START WITH 100
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.gr_seq OWNER TO postgres;

--
-- Name: growth_run_cycles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.growth_run_cycles (
    id integer NOT NULL,
    growth_run_id integer NOT NULL,
    machine_process_id integer,
    cycle_no integer NOT NULL,
    process_type character varying(40),
    prev_height numeric(10,3),
    new_height numeric(10,3),
    growth_mm numeric(10,3),
    prev_weight numeric(12,4),
    new_weight numeric(12,4),
    weight_delta numeric(12,4),
    dim_length numeric(10,3),
    dim_width numeric(10,3),
    dim_unit character varying(8) DEFAULT 'mm'::character varying,
    remarks text,
    performed_by integer,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.growth_run_cycles OWNER TO postgres;

--
-- Name: growth_run_cycles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.growth_run_cycles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.growth_run_cycles_id_seq OWNER TO postgres;

--
-- Name: growth_run_cycles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.growth_run_cycles_id_seq OWNED BY public.growth_run_cycles.id;


--
-- Name: growth_run_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.growth_run_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.growth_run_seq OWNER TO postgres;

--
-- Name: inv_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.inv_seq
    START WITH 3001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.inv_seq OWNER TO postgres;

--
-- Name: inventory; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory (
    id integer NOT NULL,
    item_id integer NOT NULL,
    lot_number character varying(30) NOT NULL,
    lot_name character varying(100),
    batch_no character varying(30),
    qty numeric(12,2) DEFAULT 0 NOT NULL,
    unit character varying(10) DEFAULT 'PCS'::character varying,
    weight numeric(12,4) DEFAULT 0,
    rate numeric(12,2) DEFAULT 0,
    total_value numeric(15,2) DEFAULT 0,
    location_id integer,
    department_id integer,
    vendor_id integer,
    purchase_date date,
    last_used date,
    status character varying(20) DEFAULT 'IN STOCK'::character varying,
    remarks text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    source_movement_id integer,
    source_type character varying(20),
    lot_code character varying(50),
    parent_lot_id integer,
    root_lot_id integer,
    operation_type character varying(20),
    split_level integer,
    genealogy_path text,
    lot_op_id bigint NOT NULL,
    dim_length numeric(10,3),
    dim_depth numeric(10,3),
    dim_height numeric(10,3),
    dim_unit character varying(10) DEFAULT 'mm'::character varying,
    source_module character varying(100),
    machine_process_id integer,
    seed_height_at_in numeric(10,3),
    weight_at_in numeric(12,4),
    actual_growth_mm numeric(10,3) GENERATED ALWAYS AS (
CASE
    WHEN ((dim_height IS NOT NULL) AND (seed_height_at_in IS NOT NULL)) THEN (dim_height - seed_height_at_in)
    ELSE NULL::numeric
END) STORED,
    weight_gain numeric(12,4) GENERATED ALWAYS AS (
CASE
    WHEN ((weight IS NOT NULL) AND (weight_at_in IS NOT NULL)) THEN (weight - weight_at_in)
    ELSE NULL::numeric
END) STORED,
    growth_pct numeric(8,2) GENERATED ALWAYS AS (
CASE
    WHEN ((dim_height IS NOT NULL) AND (seed_height_at_in IS NOT NULL) AND (seed_height_at_in > (0)::numeric)) THEN round((((dim_height - seed_height_at_in) / seed_height_at_in) * (100)::numeric), 2)
    ELSE NULL::numeric
END) STORED,
    version integer DEFAULT 1 NOT NULL,
    CONSTRAINT inventory_dim_depth_nonneg CHECK (((dim_depth IS NULL) OR (dim_depth >= (0)::numeric))),
    CONSTRAINT inventory_dim_height_nonneg CHECK (((dim_height IS NULL) OR (dim_height >= (0)::numeric))),
    CONSTRAINT inventory_dim_length_nonneg CHECK (((dim_length IS NULL) OR (dim_length >= (0)::numeric))),
    CONSTRAINT inventory_seed_height_at_in_nonneg CHECK (((seed_height_at_in IS NULL) OR (seed_height_at_in >= (0)::numeric))),
    CONSTRAINT inventory_status_valid CHECK (((status)::text = ANY ((ARRAY['IN STOCK'::character varying, 'IN PROCESS'::character varying, 'CONSUMED'::character varying, 'DAMAGED'::character varying, 'SOLD'::character varying, 'ARCHIVED'::character varying, 'DISPOSED'::character varying, 'LOW STOCK'::character varying, 'REPROCESS'::character varying, 'QC_HOLD'::character varying])::text[]))),
    CONSTRAINT inventory_weight_at_in_nonneg CHECK (((weight_at_in IS NULL) OR (weight_at_in >= (0)::numeric)))
);


ALTER TABLE public.inventory OWNER TO postgres;

--
-- Name: inventory_closing_override; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_closing_override (
    id integer NOT NULL,
    date date NOT NULL,
    item_id integer NOT NULL,
    quantity numeric(15,4) NOT NULL,
    rate numeric(15,4) NOT NULL,
    value numeric(15,2) NOT NULL,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT inventory_closing_override_quantity_check CHECK ((quantity >= (0)::numeric)),
    CONSTRAINT inventory_closing_override_rate_check CHECK ((rate >= (0)::numeric)),
    CONSTRAINT inventory_closing_override_value_check CHECK ((value >= (0)::numeric))
);


ALTER TABLE public.inventory_closing_override OWNER TO postgres;

--
-- Name: inventory_closing_override_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.inventory_closing_override_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.inventory_closing_override_id_seq OWNER TO postgres;

--
-- Name: inventory_closing_override_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.inventory_closing_override_id_seq OWNED BY public.inventory_closing_override.id;


--
-- Name: inventory_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.inventory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.inventory_id_seq OWNER TO postgres;

--
-- Name: inventory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.inventory_id_seq OWNED BY public.inventory.id;


--
-- Name: inventory_opening; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.inventory_opening (
    id integer NOT NULL,
    item_id integer NOT NULL,
    quantity numeric(15,4) NOT NULL,
    rate numeric(15,4) NOT NULL,
    value numeric(15,2) NOT NULL,
    as_of_date date NOT NULL,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT inventory_opening_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT inventory_opening_rate_check CHECK ((rate > (0)::numeric)),
    CONSTRAINT inventory_opening_value_check CHECK ((value > (0)::numeric))
);


ALTER TABLE public.inventory_opening OWNER TO postgres;

--
-- Name: inventory_opening_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.inventory_opening_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.inventory_opening_id_seq OWNER TO postgres;

--
-- Name: inventory_opening_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.inventory_opening_id_seq OWNED BY public.inventory_opening.id;


--
-- Name: invoice_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_lines (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    line_no integer DEFAULT 1,
    inventory_id integer,
    lot_number character varying(30),
    lot_name character varying(100),
    qty numeric(12,2) DEFAULT 1,
    weight numeric(12,4) DEFAULT 0,
    color character varying(20),
    clarity character varying(20),
    rate_per_carat numeric(12,2) DEFAULT 0,
    amount numeric(15,2) DEFAULT 0,
    cost_value numeric(15,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.invoice_lines OWNER TO postgres;

--
-- Name: invoice_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoice_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoice_lines_id_seq OWNER TO postgres;

--
-- Name: invoice_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.invoice_lines_id_seq OWNED BY public.invoice_lines.id;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoices (
    id integer CONSTRAINT invoices_id_not_null1 NOT NULL,
    doc_number character varying(20) CONSTRAINT invoices_doc_number_not_null1 NOT NULL,
    doc_date date CONSTRAINT invoices_doc_date_not_null1 NOT NULL,
    invoice_type character varying(20) DEFAULT 'sale'::character varying,
    customer_id integer,
    payment_term character varying(30) DEFAULT '30 Days'::character varying,
    currency character varying(3) DEFAULT 'INR'::character varying,
    reference_no character varying(50),
    remark text,
    total_qty numeric(12,2) DEFAULT 0,
    total_weight numeric(12,4) DEFAULT 0,
    sub_total numeric(15,2) DEFAULT 0,
    tax_pct numeric(5,2) DEFAULT 5,
    tax_amount numeric(12,2) DEFAULT 0,
    grand_total numeric(15,2) DEFAULT 0,
    amount_paid numeric(15,2) DEFAULT 0,
    balance_due numeric(15,2) DEFAULT 0,
    je_id integer,
    cogs_je_id integer,
    status public.doc_status DEFAULT 'open'::public.doc_status,
    payment_status character varying(20) DEFAULT 'UNPAID'::character varying,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    version integer DEFAULT 1 NOT NULL
);


ALTER TABLE public.invoices OWNER TO postgres;

--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoices_id_seq OWNER TO postgres;

--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;


--
-- Name: invoices_old; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoices_old (
    id integer DEFAULT nextval('public.invoices_id_seq'::regclass) CONSTRAINT invoices_id_not_null NOT NULL,
    doc_number character varying(20) CONSTRAINT invoices_doc_number_not_null NOT NULL,
    doc_date date CONSTRAINT invoices_doc_date_not_null NOT NULL,
    invoice_type character varying(20) DEFAULT 'sale'::character varying,
    customer_id integer,
    payment_term character varying(30) DEFAULT '30 Days'::character varying,
    currency character varying(3) DEFAULT 'INR'::character varying,
    reference_no character varying(50),
    remark text,
    total_qty numeric(12,2) DEFAULT 0,
    total_weight numeric(12,4) DEFAULT 0,
    sub_total numeric(15,2) DEFAULT 0,
    tax_pct numeric(5,2) DEFAULT 5,
    tax_amount numeric(12,2) DEFAULT 0,
    grand_total numeric(15,2) DEFAULT 0,
    amount_paid numeric(15,2) DEFAULT 0,
    balance_due numeric(15,2) DEFAULT 0,
    je_id integer,
    cogs_je_id integer,
    status public.doc_status DEFAULT 'open'::public.doc_status,
    payment_status character varying(20) DEFAULT 'UNPAID'::character varying,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.invoices_old OWNER TO postgres;

--
-- Name: items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.items (
    id integer NOT NULL,
    code character varying(30) NOT NULL,
    name character varying(150) NOT NULL,
    category public.item_category NOT NULL,
    type public.item_type DEFAULT 'raw_material'::public.item_type NOT NULL,
    default_uom character varying(10) DEFAULT 'Pcs'::character varying,
    hsn_code character varying(20),
    reorder_level integer DEFAULT 0,
    description text,
    status public.master_status DEFAULT 'active'::public.master_status,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_capital_asset boolean DEFAULT false NOT NULL,
    fixed_asset_category_id integer,
    quantity_on_hand numeric(15,4) DEFAULT 0 NOT NULL,
    avg_cost numeric(15,4) DEFAULT 0 NOT NULL,
    last_purchase_cost numeric(15,4) DEFAULT 0 NOT NULL,
    inventory_value numeric(15,2) DEFAULT 0 NOT NULL
);


ALTER TABLE public.items OWNER TO postgres;

--
-- Name: items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.items_id_seq OWNER TO postgres;

--
-- Name: items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.items_id_seq OWNED BY public.items.id;


--
-- Name: je_allocations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.je_allocations (
    id integer NOT NULL,
    entity_type character varying(20) NOT NULL,
    entity_id integer NOT NULL,
    je_id integer NOT NULL,
    je_line_id integer,
    target_type character varying(20) NOT NULL,
    target_id integer NOT NULL,
    allocated_amount numeric(15,2) NOT NULL,
    allocation_date date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT je_allocations_allocated_amount_check CHECK ((allocated_amount > (0)::numeric)),
    CONSTRAINT je_allocations_entity_type_check CHECK (((entity_type)::text = ANY (ARRAY[('vendor'::character varying)::text, ('customer'::character varying)::text]))),
    CONSTRAINT je_allocations_target_type_check CHECK (((target_type)::text = ANY (ARRAY[('bill'::character varying)::text, ('invoice'::character varying)::text])))
);


ALTER TABLE public.je_allocations OWNER TO postgres;

--
-- Name: je_allocations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.je_allocations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.je_allocations_id_seq OWNER TO postgres;

--
-- Name: je_allocations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.je_allocations_id_seq OWNED BY public.je_allocations.id;


--
-- Name: je_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.je_lines (
    id integer CONSTRAINT je_lines_id_not_null1 NOT NULL,
    je_id integer CONSTRAINT je_lines_je_id_not_null1 NOT NULL,
    account_id integer CONSTRAINT je_lines_account_id_not_null1 NOT NULL,
    debit numeric(15,2) DEFAULT 0.00,
    credit numeric(15,2) DEFAULT 0.00,
    narration text,
    created_at timestamp with time zone DEFAULT now(),
    cost_center_id integer,
    entity_type character varying(30),
    entity_id integer,
    reference_no character varying(50),
    CONSTRAINT je_line_single_side CHECK ((((debit > (0)::numeric) AND (credit = (0)::numeric)) OR ((debit = (0)::numeric) AND (credit > (0)::numeric))))
);


ALTER TABLE public.je_lines OWNER TO postgres;

--
-- Name: je_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.je_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.je_lines_id_seq OWNER TO postgres;

--
-- Name: je_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.je_lines_id_seq OWNED BY public.je_lines.id;


--
-- Name: je_lines_old; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.je_lines_old (
    id integer DEFAULT nextval('public.je_lines_id_seq'::regclass) CONSTRAINT je_lines_id_not_null NOT NULL,
    je_id integer CONSTRAINT je_lines_je_id_not_null NOT NULL,
    account_id integer CONSTRAINT je_lines_account_id_not_null NOT NULL,
    debit numeric(15,2) DEFAULT 0.00,
    credit numeric(15,2) DEFAULT 0.00,
    narration text,
    created_at timestamp with time zone DEFAULT now(),
    cost_center_id integer,
    entity_type character varying(30),
    entity_id bigint,
    reference_no character varying(50),
    CONSTRAINT je_line_single_side CHECK ((((debit > (0)::numeric) AND (credit = (0)::numeric)) OR ((debit = (0)::numeric) AND (credit > (0)::numeric))))
);


ALTER TABLE public.je_lines_old OWNER TO postgres;

--
-- Name: je_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.je_seq
    START WITH 4001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.je_seq OWNER TO postgres;

--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.journal_entries (
    id integer CONSTRAINT journal_entries_id_not_null1 NOT NULL,
    je_number character varying(20) CONSTRAINT journal_entries_je_number_not_null1 NOT NULL,
    date date CONSTRAINT journal_entries_date_not_null1 NOT NULL,
    description text,
    source_type character varying(30),
    source_id integer,
    total_debit numeric(15,2) DEFAULT 0 CONSTRAINT journal_entries_total_debit_not_null1 NOT NULL,
    total_credit numeric(15,2) DEFAULT 0 CONSTRAINT journal_entries_total_credit_not_null1 NOT NULL,
    status public.je_status DEFAULT 'draft'::public.je_status,
    posted_at timestamp with time zone,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    reference_no character varying(50),
    reversal_of_je_id integer,
    is_reversed boolean DEFAULT false CONSTRAINT journal_entries_is_reversed_not_null1 NOT NULL,
    reversed_at timestamp with time zone,
    reversed_by integer,
    CONSTRAINT je_balanced CHECK ((total_debit = total_credit))
);


ALTER TABLE public.journal_entries OWNER TO postgres;

--
-- Name: journal_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.journal_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.journal_entries_id_seq OWNER TO postgres;

--
-- Name: journal_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.journal_entries_id_seq OWNED BY public.journal_entries.id;


--
-- Name: journal_entries_old; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.journal_entries_old (
    id integer DEFAULT nextval('public.journal_entries_id_seq'::regclass) CONSTRAINT journal_entries_id_not_null NOT NULL,
    je_number character varying(20) CONSTRAINT journal_entries_je_number_not_null NOT NULL,
    date date CONSTRAINT journal_entries_date_not_null NOT NULL,
    description text,
    source_type character varying(30),
    source_id integer,
    total_debit numeric(15,2) DEFAULT 0 CONSTRAINT journal_entries_total_debit_not_null NOT NULL,
    total_credit numeric(15,2) DEFAULT 0 CONSTRAINT journal_entries_total_credit_not_null NOT NULL,
    status public.je_status DEFAULT 'draft'::public.je_status,
    posted_at timestamp with time zone,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    reference_no character varying(50),
    reversal_of_je_id integer,
    is_reversed boolean DEFAULT false CONSTRAINT journal_entries_is_reversed_not_null NOT NULL,
    reversed_at timestamp with time zone,
    reversed_by integer,
    CONSTRAINT je_balanced CHECK ((total_debit = total_credit))
);


ALTER TABLE public.journal_entries_old OWNER TO postgres;

--
-- Name: lm_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lm_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lm_seq OWNER TO postgres;

--
-- Name: locations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.locations (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    type character varying(30) DEFAULT 'factory'::character varying,
    address text,
    city character varying(50),
    state character varying(50),
    manager character varying(100),
    status public.master_status DEFAULT 'active'::public.master_status,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.locations OWNER TO postgres;

--
-- Name: locations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.locations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.locations_id_seq OWNER TO postgres;

--
-- Name: locations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.locations_id_seq OWNED BY public.locations.id;


--
-- Name: login_attempts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.login_attempts (
    id integer NOT NULL,
    username character varying(255) NOT NULL,
    ip_address character varying(45) NOT NULL,
    success boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.login_attempts OWNER TO postgres;

--
-- Name: login_attempts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.login_attempts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.login_attempts_id_seq OWNER TO postgres;

--
-- Name: login_attempts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.login_attempts_id_seq OWNED BY public.login_attempts.id;


--
-- Name: lot_issue_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lot_issue_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lot_issue_seq OWNER TO postgres;

--
-- Name: lot_mix_components; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lot_mix_components (
    id integer NOT NULL,
    mixed_lot_id integer NOT NULL,
    source_lot_id integer NOT NULL,
    qty numeric(15,4) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT lot_mix_components_qty_check CHECK ((qty > (0)::numeric))
);


ALTER TABLE public.lot_mix_components OWNER TO postgres;

--
-- Name: lot_mix_components_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lot_mix_components_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lot_mix_components_id_seq OWNER TO postgres;

--
-- Name: lot_mix_components_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lot_mix_components_id_seq OWNED BY public.lot_mix_components.id;


--
-- Name: lot_movement_children; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lot_movement_children (
    id integer NOT NULL,
    movement_id integer NOT NULL,
    child_lot_id integer NOT NULL,
    quantity numeric(15,4) NOT NULL,
    cost_per_unit numeric(15,4) NOT NULL,
    CONSTRAINT lot_movement_children_quantity_check CHECK ((quantity > (0)::numeric))
);


ALTER TABLE public.lot_movement_children OWNER TO postgres;

--
-- Name: lot_movement_children_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lot_movement_children_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lot_movement_children_id_seq OWNER TO postgres;

--
-- Name: lot_movement_children_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lot_movement_children_id_seq OWNED BY public.lot_movement_children.id;


--
-- Name: lot_movement_parents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lot_movement_parents (
    id integer NOT NULL,
    movement_id integer NOT NULL,
    parent_lot_id integer NOT NULL,
    quantity_consumed numeric(15,4) NOT NULL,
    cost_per_unit numeric(15,4) NOT NULL,
    CONSTRAINT lot_movement_parents_quantity_consumed_check CHECK ((quantity_consumed > (0)::numeric))
);


ALTER TABLE public.lot_movement_parents OWNER TO postgres;

--
-- Name: lot_movement_parents_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lot_movement_parents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lot_movement_parents_id_seq OWNER TO postgres;

--
-- Name: lot_movement_parents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lot_movement_parents_id_seq OWNED BY public.lot_movement_parents.id;


--
-- Name: lot_movements; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lot_movements (
    id integer CONSTRAINT lot_movements_id_not_null1 NOT NULL,
    movement_number character varying(20) CONSTRAINT lot_movements_movement_number_not_null1 NOT NULL,
    movement_type public.lot_movement_type CONSTRAINT lot_movements_movement_type_not_null1 NOT NULL,
    movement_date date DEFAULT CURRENT_DATE CONSTRAINT lot_movements_movement_date_not_null1 NOT NULL,
    notes text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.lot_movements OWNER TO postgres;

--
-- Name: lot_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lot_movements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lot_movements_id_seq OWNER TO postgres;

--
-- Name: lot_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lot_movements_id_seq OWNED BY public.lot_movements.id;


--
-- Name: lot_movements_old; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lot_movements_old (
    id integer DEFAULT nextval('public.lot_movements_id_seq'::regclass) CONSTRAINT lot_movements_id_not_null NOT NULL,
    movement_number character varying(20) CONSTRAINT lot_movements_movement_number_not_null NOT NULL,
    movement_type public.lot_movement_type CONSTRAINT lot_movements_movement_type_not_null NOT NULL,
    movement_date date DEFAULT CURRENT_DATE CONSTRAINT lot_movements_movement_date_not_null NOT NULL,
    notes text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.lot_movements_old OWNER TO postgres;

--
-- Name: lot_op_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lot_op_id_seq
    START WITH 100001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lot_op_id_seq OWNER TO postgres;

--
-- Name: lot_op_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lot_op_log (
    id integer NOT NULL,
    lot_id integer NOT NULL,
    operation character varying(30) NOT NULL,
    reference_type character varying(30),
    reference_id integer,
    qty_delta numeric(15,4),
    new_status character varying(20),
    notes text,
    performed_by integer,
    performed_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.lot_op_log OWNER TO postgres;

--
-- Name: lot_op_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lot_op_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lot_op_log_id_seq OWNER TO postgres;

--
-- Name: lot_op_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lot_op_log_id_seq OWNED BY public.lot_op_log.id;


--
-- Name: lot_process_issues; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lot_process_issues (
    id integer NOT NULL,
    issue_number character varying(20) NOT NULL,
    source_lot_id integer NOT NULL,
    process_lot_id integer,
    issued_qty numeric(15,4) NOT NULL,
    issue_date date DEFAULT CURRENT_DATE NOT NULL,
    expected_return date,
    department character varying(100),
    operator character varying(100),
    remarks text,
    status character varying(20) DEFAULT 'OPEN'::character varying NOT NULL,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    machine_id integer,
    operator_id integer,
    machine_process_id integer,
    process_type character varying(50),
    target_runtime_hours numeric(6,2),
    expected_rough_qty numeric(10,3),
    remaining_in_process numeric(12,4),
    CONSTRAINT lot_process_issues_issued_qty_check CHECK ((issued_qty > (0)::numeric))
);


ALTER TABLE public.lot_process_issues OWNER TO postgres;

--
-- Name: lot_process_issues_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lot_process_issues_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lot_process_issues_id_seq OWNER TO postgres;

--
-- Name: lot_process_issues_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lot_process_issues_id_seq OWNED BY public.lot_process_issues.id;


--
-- Name: lot_process_returns; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lot_process_returns (
    id integer NOT NULL,
    return_number character varying(20) NOT NULL,
    issue_id integer NOT NULL,
    return_date date DEFAULT CURRENT_DATE NOT NULL,
    usable_qty numeric(15,4) DEFAULT 0 NOT NULL,
    damaged_qty numeric(15,4) DEFAULT 0 NOT NULL,
    consumed_qty numeric(15,4) DEFAULT 0 NOT NULL,
    remarks text,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    is_final boolean DEFAULT true NOT NULL,
    remaining_after numeric(12,4) DEFAULT 0 NOT NULL,
    CONSTRAINT lot_process_returns_consumed_qty_check CHECK ((consumed_qty >= (0)::numeric)),
    CONSTRAINT lot_process_returns_damaged_qty_check CHECK ((damaged_qty >= (0)::numeric)),
    CONSTRAINT lot_process_returns_usable_qty_check CHECK ((usable_qty >= (0)::numeric))
);


ALTER TABLE public.lot_process_returns OWNER TO postgres;

--
-- Name: lot_process_returns_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lot_process_returns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lot_process_returns_id_seq OWNER TO postgres;

--
-- Name: lot_process_returns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lot_process_returns_id_seq OWNED BY public.lot_process_returns.id;


--
-- Name: lot_return_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lot_return_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lot_return_seq OWNER TO postgres;

--
-- Name: machine_process_lots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.machine_process_lots (
    id integer NOT NULL,
    process_id integer NOT NULL,
    inventory_lot_id integer NOT NULL,
    issued_qty numeric(10,3) DEFAULT 0,
    issued_weight numeric(10,4) DEFAULT 0,
    returned_qty numeric(10,3) DEFAULT 0,
    damaged_qty numeric(10,3) DEFAULT 0,
    consumed_qty numeric(10,3) DEFAULT 0
);


ALTER TABLE public.machine_process_lots OWNER TO postgres;

--
-- Name: machine_process_lots_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.machine_process_lots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.machine_process_lots_id_seq OWNER TO postgres;

--
-- Name: machine_process_lots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.machine_process_lots_id_seq OWNED BY public.machine_process_lots.id;


--
-- Name: machine_process_materials; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.machine_process_materials (
    id integer NOT NULL,
    process_id integer NOT NULL,
    material_id integer,
    material_name character varying(100),
    qty numeric(10,4),
    unit character varying(20)
);


ALTER TABLE public.machine_process_materials OWNER TO postgres;

--
-- Name: machine_process_materials_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.machine_process_materials_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.machine_process_materials_id_seq OWNER TO postgres;

--
-- Name: machine_process_materials_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.machine_process_materials_id_seq OWNED BY public.machine_process_materials.id;


--
-- Name: machine_process_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.machine_process_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.machine_process_seq OWNER TO postgres;

--
-- Name: machine_processes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.machine_processes (
    id integer NOT NULL,
    process_number character varying(30) NOT NULL,
    machine_id integer NOT NULL,
    operator_id integer,
    process_type character varying(50) DEFAULT 'growth'::character varying NOT NULL,
    status character varying(20) DEFAULT 'running'::character varying NOT NULL,
    started_at timestamp without time zone DEFAULT now() NOT NULL,
    paused_at timestamp without time zone,
    completed_at timestamp without time zone,
    target_runtime_hours numeric(6,2),
    expected_completion_at timestamp without time zone,
    total_paused_minutes numeric(8,2) DEFAULT 0,
    expected_rough_qty numeric(10,3),
    expected_height numeric(8,3),
    remarks text,
    created_by integer,
    created_at timestamp without time zone DEFAULT now(),
    output_entry_id integer,
    output_completed_at timestamp with time zone,
    actual_output_qty numeric(10,4),
    actual_yield_pct numeric(6,2),
    CONSTRAINT machine_processes_status_check CHECK (((status)::text = ANY ((ARRAY['running'::character varying, 'hold'::character varying, 'completed'::character varying, 'cancelled'::character varying])::text[])))
);


ALTER TABLE public.machine_processes OWNER TO postgres;

--
-- Name: machine_processes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.machine_processes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.machine_processes_id_seq OWNER TO postgres;

--
-- Name: machine_processes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.machine_processes_id_seq OWNED BY public.machine_processes.id;


--
-- Name: machine_status_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.machine_status_logs (
    id integer NOT NULL,
    machine_id integer NOT NULL,
    old_status character varying(20),
    new_status character varying(20) NOT NULL,
    changed_at timestamp without time zone DEFAULT now() NOT NULL,
    changed_by integer,
    remarks text
);


ALTER TABLE public.machine_status_logs OWNER TO postgres;

--
-- Name: machine_status_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.machine_status_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.machine_status_logs_id_seq OWNER TO postgres;

--
-- Name: machine_status_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.machine_status_logs_id_seq OWNED BY public.machine_status_logs.id;


--
-- Name: machines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.machines (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    type character varying(50),
    department_id integer,
    location_id integer,
    capacity character varying(50),
    last_service date,
    next_service date,
    status public.machine_status DEFAULT 'running'::public.machine_status,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.machines OWNER TO postgres;

--
-- Name: machines_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.machines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.machines_id_seq OWNER TO postgres;

--
-- Name: machines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.machines_id_seq OWNED BY public.machines.id;


--
-- Name: migrations_history; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.migrations_history (
    id integer NOT NULL,
    filename character varying(255) NOT NULL,
    applied_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.migrations_history OWNER TO postgres;

--
-- Name: migrations_history_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.migrations_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.migrations_history_id_seq OWNER TO postgres;

--
-- Name: migrations_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.migrations_history_id_seq OWNED BY public.migrations_history.id;


--
-- Name: mv_dashboard_financial; Type: MATERIALIZED VIEW; Schema: public; Owner: postgres
--

CREATE MATERIALIZED VIEW public.mv_dashboard_financial AS
 SELECT date_trunc('month'::text, (je.date)::timestamp with time zone) AS month,
    a.type,
    a.id AS account_id,
    a.code AS account_code,
    a.name AS account_name,
    round(COALESCE(sum(jl.debit), (0)::numeric), 2) AS total_debit,
    round(COALESCE(sum(jl.credit), (0)::numeric), 2) AS total_credit
   FROM ((public.accounts a
     JOIN public.je_lines_old jl ON ((jl.account_id = a.id)))
     JOIN public.journal_entries_old je ON ((je.id = jl.je_id)))
  WHERE ((a.is_group = false) AND (je.status = 'posted'::public.je_status) AND (je.date >= (date_trunc('year'::text, now()) - '2 years'::interval)))
  GROUP BY (date_trunc('month'::text, (je.date)::timestamp with time zone)), a.type, a.id, a.code, a.name
  WITH NO DATA;


ALTER MATERIALIZED VIEW public.mv_dashboard_financial OWNER TO postgres;

--
-- Name: mv_trial_balance; Type: MATERIALIZED VIEW; Schema: public; Owner: postgres
--

CREATE MATERIALIZED VIEW public.mv_trial_balance AS
 SELECT a.id AS account_id,
    a.code,
    a.name,
    a.type,
    a.is_group,
    round(COALESCE(sum(jl.debit), (0)::numeric), 2) AS total_debit,
    round(COALESCE(sum(jl.credit), (0)::numeric), 2) AS total_credit
   FROM ((public.accounts a
     LEFT JOIN public.je_lines_old jl ON ((jl.account_id = a.id)))
     LEFT JOIN public.journal_entries_old je ON (((je.id = jl.je_id) AND (je.status = 'posted'::public.je_status))))
  WHERE (a.is_group = false)
  GROUP BY a.id, a.code, a.name, a.type, a.is_group
  WITH NO DATA;


ALTER MATERIALIZED VIEW public.mv_trial_balance OWNER TO postgres;

--
-- Name: pay_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pay_seq
    START WITH 500
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pay_seq OWNER TO postgres;

--
-- Name: payment_allocations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payment_allocations (
    id integer NOT NULL,
    payment_id integer NOT NULL,
    purchase_note_id integer NOT NULL,
    amount numeric(15,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT payment_allocations_amount_check CHECK ((amount > (0)::numeric))
);


ALTER TABLE public.payment_allocations OWNER TO postgres;

--
-- Name: payment_allocations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.payment_allocations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.payment_allocations_id_seq OWNER TO postgres;

--
-- Name: payment_allocations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.payment_allocations_id_seq OWNED BY public.payment_allocations.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    doc_number character varying(20) NOT NULL,
    date date NOT NULL,
    vendor_id integer,
    amount numeric(15,2) NOT NULL,
    payment_mode character varying(30) DEFAULT 'Bank Transfer'::character varying,
    bank_account_id integer,
    reference_no character varying(50),
    cheque_no character varying(30),
    cheque_date date,
    remark text,
    purchase_note_id integer,
    je_id integer,
    status character varying(20) DEFAULT 'COMPLETED'::character varying,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    advance_amount numeric(15,2) DEFAULT 0
);


ALTER TABLE public.payments OWNER TO postgres;

--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.payments_id_seq OWNER TO postgres;

--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: pending_transfer_lots; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pending_transfer_lots (
    id integer NOT NULL,
    pending_transfer_id integer,
    lot_id integer,
    transfer_qty numeric(15,4)
);


ALTER TABLE public.pending_transfer_lots OWNER TO postgres;

--
-- Name: pending_transfer_lots_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pending_transfer_lots_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pending_transfer_lots_id_seq OWNER TO postgres;

--
-- Name: pending_transfer_lots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.pending_transfer_lots_id_seq OWNED BY public.pending_transfer_lots.id;


--
-- Name: pending_transfers; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.pending_transfers (
    id integer NOT NULL,
    transfer_id character varying(50) NOT NULL,
    source_location_id integer,
    destination_location_id integer,
    source_account_name character varying(100),
    dest_account_name character varying(100),
    status character varying(20) DEFAULT 'Pending'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    created_by integer,
    approved_by integer,
    approved_at timestamp without time zone,
    dest_location_name character varying(100)
);


ALTER TABLE public.pending_transfers OWNER TO postgres;

--
-- Name: pending_transfers_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pending_transfers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pending_transfers_id_seq OWNER TO postgres;

--
-- Name: pending_transfers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.pending_transfers_id_seq OWNED BY public.pending_transfers.id;


--
-- Name: permission_audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.permission_audit_logs (
    id integer NOT NULL,
    user_id integer,
    action character varying(50) NOT NULL,
    target_type character varying(50) NOT NULL,
    target_id integer,
    changes jsonb,
    ip_address character varying(45),
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.permission_audit_logs OWNER TO postgres;

--
-- Name: permission_audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.permission_audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.permission_audit_logs_id_seq OWNER TO postgres;

--
-- Name: permission_audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.permission_audit_logs_id_seq OWNED BY public.permission_audit_logs.id;


--
-- Name: pn_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pn_seq
    START WITH 2050
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pn_seq OWNER TO postgres;

--
-- Name: pr_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.pr_seq
    START WITH 1100
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.pr_seq OWNER TO postgres;

--
-- Name: process_master; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.process_master (
    id integer NOT NULL,
    process_code character varying(50) NOT NULL,
    process_name character varying(100) NOT NULL,
    category character varying(20) DEFAULT 'PRIMARY'::character varying NOT NULL,
    requires_inventory boolean DEFAULT true NOT NULL,
    requires_machine boolean DEFAULT true NOT NULL,
    requires_operator boolean DEFAULT false NOT NULL,
    requires_runtime boolean DEFAULT false NOT NULL,
    requires_expected_yield boolean DEFAULT false NOT NULL,
    allows_consumables boolean DEFAULT false NOT NULL,
    output_type character varying(20) DEFAULT 'NONE'::character varying NOT NULL,
    default_runtime_hours numeric(6,2),
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    completion_mode character varying(20) DEFAULT 'RETURN_BASED'::character varying NOT NULL,
    process_group character varying(20),
    input_item_category character varying(20),
    eligible_machine_type character varying(30),
    CONSTRAINT process_master_category_check CHECK (((category)::text = ANY (ARRAY[('PRIMARY'::character varying)::text, ('SUPPORT'::character varying)::text, ('QC'::character varying)::text, ('OTHER'::character varying)::text]))),
    CONSTRAINT process_master_completion_mode_check CHECK (((completion_mode)::text = ANY (ARRAY[('RETURN_BASED'::character varying)::text, ('OUTPUT_BASED'::character varying)::text]))),
    CONSTRAINT process_master_group_valid CHECK (((process_group IS NULL) OR ((process_group)::text = ANY ((ARRAY['GROWTH'::character varying, 'LASER'::character varying, 'POLISHING'::character varying, 'QC'::character varying, 'PACKING'::character varying, 'OTHER'::character varying])::text[])))),
    CONSTRAINT process_master_output_type_check CHECK (((output_type)::text = ANY (ARRAY[('ROUGH'::character varying)::text, ('POLISHED'::character varying)::text, ('NONE'::character varying)::text, ('CUSTOM'::character varying)::text])))
);


ALTER TABLE public.process_master OWNER TO postgres;

--
-- Name: process_master_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.process_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.process_master_id_seq OWNER TO postgres;

--
-- Name: process_master_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.process_master_id_seq OWNED BY public.process_master.id;


--
-- Name: process_return_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.process_return_lines (
    id integer NOT NULL,
    return_id integer NOT NULL,
    return_type character varying(20) NOT NULL,
    qty numeric(12,4) NOT NULL,
    lot_id integer,
    lot_code character varying(100),
    remarks text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT process_return_lines_qty_check CHECK ((qty > (0)::numeric)),
    CONSTRAINT process_return_lines_return_type_check CHECK (((return_type)::text = ANY (ARRAY[('usable'::character varying)::text, ('damaged'::character varying)::text, ('consumed'::character varying)::text, ('reprocess'::character varying)::text, ('qc_hold'::character varying)::text])))
);


ALTER TABLE public.process_return_lines OWNER TO postgres;

--
-- Name: process_return_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.process_return_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.process_return_lines_id_seq OWNER TO postgres;

--
-- Name: process_return_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.process_return_lines_id_seq OWNED BY public.process_return_lines.id;


--
-- Name: process_transaction_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.process_transaction_lines (
    id integer NOT NULL,
    process_trs_id integer NOT NULL,
    inventory_id integer,
    lot_number character varying(30),
    lot_name character varying(100),
    item_type character varying(30),
    qty_in numeric(12,2) DEFAULT 0,
    wt_in numeric(12,4) DEFAULT 0,
    qty_out numeric(12,2) DEFAULT 0,
    wt_out numeric(12,4) DEFAULT 0,
    yield_pct numeric(8,2) DEFAULT 0,
    next_process character varying(50),
    remark text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.process_transaction_lines OWNER TO postgres;

--
-- Name: process_transaction_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.process_transaction_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.process_transaction_lines_id_seq OWNER TO postgres;

--
-- Name: process_transaction_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.process_transaction_lines_id_seq OWNED BY public.process_transaction_lines.id;


--
-- Name: process_transactions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.process_transactions (
    id integer NOT NULL,
    trs_number character varying(20) NOT NULL,
    trs_type public.process_trs_type NOT NULL,
    trs_date date NOT NULL,
    process_name character varying(50) NOT NULL,
    machine_id integer,
    department_id integer,
    worker_name character varying(100),
    expected_return date,
    priority character varying(20) DEFAULT 'Normal'::character varying,
    remark text,
    send_ref_id integer,
    return_status character varying(30),
    total_qty_in numeric(12,2) DEFAULT 0,
    total_wt_in numeric(12,4) DEFAULT 0,
    total_qty_out numeric(12,2) DEFAULT 0,
    total_wt_out numeric(12,4) DEFAULT 0,
    parameters jsonb DEFAULT '{}'::jsonb,
    je_id integer,
    status character varying(20) DEFAULT 'OPEN'::character varying,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    version integer DEFAULT 1 NOT NULL
);


ALTER TABLE public.process_transactions OWNER TO postgres;

--
-- Name: process_transactions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.process_transactions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.process_transactions_id_seq OWNER TO postgres;

--
-- Name: process_transactions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.process_transactions_id_seq OWNED BY public.process_transactions.id;


--
-- Name: ps_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ps_seq
    START WITH 1100
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ps_seq OWNER TO postgres;

--
-- Name: purchase_note_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.purchase_note_lines (
    id integer NOT NULL,
    purchase_note_id integer NOT NULL,
    line_no integer DEFAULT 1,
    item_id bigint,
    description text,
    batch_no character varying(30),
    qty numeric(12,2) NOT NULL,
    unit character varying(10) DEFAULT 'PCS'::character varying,
    rate numeric(12,2) DEFAULT 0 NOT NULL,
    amount numeric(15,2) DEFAULT 0,
    tax_pct numeric(5,2) DEFAULT 0,
    tax_amount numeric(12,2) DEFAULT 0,
    total numeric(15,2) DEFAULT 0,
    inventory_id integer,
    created_at timestamp with time zone DEFAULT now(),
    is_capital boolean DEFAULT false NOT NULL
);


ALTER TABLE public.purchase_note_lines OWNER TO postgres;

--
-- Name: purchase_note_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.purchase_note_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.purchase_note_lines_id_seq OWNER TO postgres;

--
-- Name: purchase_note_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.purchase_note_lines_id_seq OWNED BY public.purchase_note_lines.id;


--
-- Name: purchase_notes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.purchase_notes (
    id integer CONSTRAINT purchase_notes_id_not_null1 NOT NULL,
    doc_number character varying(20) CONSTRAINT purchase_notes_doc_number_not_null1 NOT NULL,
    doc_date date CONSTRAINT purchase_notes_doc_date_not_null1 NOT NULL,
    vendor_id integer,
    item_type character varying(30),
    department_id integer,
    payment_term character varying(30) DEFAULT 'Immediate'::character varying,
    currency character varying(3) DEFAULT 'INR'::character varying,
    reference_no character varying(50),
    remark text,
    total_qty numeric(12,2) DEFAULT 0,
    total_amount numeric(15,2) DEFAULT 0,
    tax_amount numeric(12,2) DEFAULT 0,
    grand_total numeric(15,2) DEFAULT 0,
    je_id integer,
    status public.doc_status DEFAULT 'draft'::public.doc_status,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    amount_paid numeric(15,2) DEFAULT 0,
    balance_due numeric(15,2) DEFAULT 0,
    payment_status character varying(20) DEFAULT 'UNPAID'::character varying,
    version integer DEFAULT 1 NOT NULL
);


ALTER TABLE public.purchase_notes OWNER TO postgres;

--
-- Name: purchase_notes_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.purchase_notes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.purchase_notes_id_seq OWNER TO postgres;

--
-- Name: purchase_notes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.purchase_notes_id_seq OWNED BY public.purchase_notes.id;


--
-- Name: purchase_notes_old; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.purchase_notes_old (
    id integer DEFAULT nextval('public.purchase_notes_id_seq'::regclass) CONSTRAINT purchase_notes_id_not_null NOT NULL,
    doc_number character varying(20) CONSTRAINT purchase_notes_doc_number_not_null NOT NULL,
    doc_date date CONSTRAINT purchase_notes_doc_date_not_null NOT NULL,
    vendor_id integer,
    item_type character varying(30),
    department_id integer,
    payment_term character varying(30) DEFAULT 'Immediate'::character varying,
    currency character varying(3) DEFAULT 'INR'::character varying,
    reference_no character varying(50),
    remark text,
    total_qty numeric(12,2) DEFAULT 0,
    total_amount numeric(15,2) DEFAULT 0,
    tax_amount numeric(12,2) DEFAULT 0,
    grand_total numeric(15,2) DEFAULT 0,
    je_id integer,
    status public.doc_status DEFAULT 'draft'::public.doc_status,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    amount_paid numeric(15,2) DEFAULT 0,
    balance_due numeric(15,2) DEFAULT 0,
    payment_status character varying(20) DEFAULT 'UNPAID'::character varying
);


ALTER TABLE public.purchase_notes_old OWNER TO postgres;

--
-- Name: rct_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rct_seq
    START WITH 500
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rct_seq OWNER TO postgres;

--
-- Name: rd_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rd_seq
    START WITH 5030
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rd_seq OWNER TO postgres;

--
-- Name: receipt_allocations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.receipt_allocations (
    id integer NOT NULL,
    receipt_id integer NOT NULL,
    invoice_id integer NOT NULL,
    amount numeric(15,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT receipt_allocations_amount_check CHECK ((amount > (0)::numeric))
);


ALTER TABLE public.receipt_allocations OWNER TO postgres;

--
-- Name: receipt_allocations_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.receipt_allocations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.receipt_allocations_id_seq OWNER TO postgres;

--
-- Name: receipt_allocations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.receipt_allocations_id_seq OWNED BY public.receipt_allocations.id;


--
-- Name: receipts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.receipts (
    id integer NOT NULL,
    doc_number character varying(20) NOT NULL,
    date date NOT NULL,
    customer_id integer,
    amount numeric(15,2) NOT NULL,
    payment_mode character varying(30) DEFAULT 'Bank Transfer'::character varying,
    bank_account_id integer,
    reference_no character varying(50),
    cheque_no character varying(30),
    cheque_date date,
    remark text,
    invoice_id integer,
    je_id integer,
    status character varying(20) DEFAULT 'COMPLETED'::character varying,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    advance_amount numeric(15,2) DEFAULT 0
);


ALTER TABLE public.receipts OWNER TO postgres;

--
-- Name: receipts_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.receipts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.receipts_id_seq OWNER TO postgres;

--
-- Name: receipts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.receipts_id_seq OWNED BY public.receipts.id;


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.refresh_tokens (
    id integer NOT NULL,
    user_id integer,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    token_hash character varying(255),
    used_at timestamp with time zone
);


ALTER TABLE public.refresh_tokens OWNER TO postgres;

--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.refresh_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.refresh_tokens_id_seq OWNER TO postgres;

--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.refresh_tokens_id_seq OWNED BY public.refresh_tokens.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.role_permissions (
    id integer NOT NULL,
    role_id integer NOT NULL,
    module character varying(100) NOT NULL,
    submodule character varying(100) DEFAULT ''::character varying NOT NULL,
    permissions integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.role_permissions OWNER TO postgres;

--
-- Name: role_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.role_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.role_permissions_id_seq OWNER TO postgres;

--
-- Name: role_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.role_permissions_id_seq OWNED BY public.role_permissions.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    slug character varying(100) NOT NULL,
    description text,
    is_system boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.roles OWNER TO postgres;

--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.roles_id_seq OWNER TO postgres;

--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: rough_growth; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rough_growth (
    id integer NOT NULL,
    growth_number character varying(20) NOT NULL,
    growth_date date NOT NULL,
    cycle_no integer DEFAULT 1,
    machine_id integer,
    seed_inventory_id integer,
    department_id integer,
    remark text,
    total_lots integer DEFAULT 0,
    total_weight numeric(12,4) DEFAULT 0,
    cost_seed numeric(12,2) DEFAULT 0,
    cost_gas numeric(12,2) DEFAULT 0,
    cost_power numeric(12,2) DEFAULT 0,
    cost_labour numeric(12,2) DEFAULT 0,
    cost_consumable numeric(12,2) DEFAULT 0,
    cost_maintenance numeric(12,2) DEFAULT 0,
    total_cost numeric(15,2) DEFAULT 0,
    cost_per_carat numeric(12,2) DEFAULT 0,
    je_id integer,
    status character varying(20) DEFAULT 'COMPLETED'::character varying,
    created_by integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.rough_growth OWNER TO postgres;

--
-- Name: rough_growth_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rough_growth_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rough_growth_id_seq OWNER TO postgres;

--
-- Name: rough_growth_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rough_growth_id_seq OWNED BY public.rough_growth.id;


--
-- Name: rough_growth_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rough_growth_lines (
    id integer NOT NULL,
    growth_id integer NOT NULL,
    line_no integer DEFAULT 1,
    lot_number character varying(30) NOT NULL,
    weight numeric(12,4) NOT NULL,
    size_ref character varying(20),
    shape character varying(30) DEFAULT 'Rough'::character varying,
    color_est character varying(20) DEFAULT 'D-E'::character varying,
    clarity_est character varying(20) DEFAULT 'VS Est.'::character varying,
    remark text,
    inventory_id integer,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.rough_growth_lines OWNER TO postgres;

--
-- Name: rough_growth_lines_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rough_growth_lines_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rough_growth_lines_id_seq OWNER TO postgres;

--
-- Name: rough_growth_lines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rough_growth_lines_id_seq OWNED BY public.rough_growth_lines.id;


--
-- Name: seed_lot_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.seed_lot_seq
    START WITH 1001
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.seed_lot_seq OWNER TO postgres;

--
-- Name: seed_mix_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.seed_mix_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.seed_mix_seq OWNER TO postgres;

--
-- Name: session_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.session_log (
    id integer NOT NULL,
    user_id integer NOT NULL,
    login_at timestamp with time zone DEFAULT now(),
    logout_at timestamp with time zone,
    ip_address character varying(45),
    user_agent text
);


ALTER TABLE public.session_log OWNER TO postgres;

--
-- Name: session_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.session_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.session_log_id_seq OWNER TO postgres;

--
-- Name: session_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.session_log_id_seq OWNED BY public.session_log.id;


--
-- Name: st_req_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.st_req_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.st_req_seq OWNER TO postgres;

--
-- Name: st_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.st_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.st_seq OWNER TO postgres;

--
-- Name: stock_transfer; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stock_transfer (
    id integer NOT NULL,
    transfer_number character varying(255) NOT NULL,
    status character varying(50) DEFAULT 'Pending'::character varying NOT NULL,
    source_location_id integer,
    destination_location_id integer,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    created_by integer
);


ALTER TABLE public.stock_transfer OWNER TO postgres;

--
-- Name: stock_transfer_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stock_transfer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_transfer_id_seq OWNER TO postgres;

--
-- Name: stock_transfer_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stock_transfer_id_seq OWNED BY public.stock_transfer.id;


--
-- Name: stock_transfer_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.stock_transfer_items (
    id integer NOT NULL,
    stock_transfer_id integer,
    lot_id integer,
    transfer_qty numeric(15,4) NOT NULL
);


ALTER TABLE public.stock_transfer_items OWNER TO postgres;

--
-- Name: stock_transfer_items_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stock_transfer_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_transfer_items_id_seq OWNER TO postgres;

--
-- Name: stock_transfer_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.stock_transfer_items_id_seq OWNED BY public.stock_transfer_items.id;


--
-- Name: stock_transfer_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.stock_transfer_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_transfer_seq OWNER TO postgres;

--
-- Name: sys_event_outbox; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sys_event_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    topic character varying(255) NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.sys_event_outbox OWNER TO postgres;

--
-- Name: uom; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.uom (
    id integer NOT NULL,
    code character varying(10) NOT NULL,
    name character varying(50) NOT NULL,
    symbol character varying(10),
    type character varying(20) DEFAULT 'count'::character varying,
    status public.master_status DEFAULT 'active'::public.master_status
);


ALTER TABLE public.uom OWNER TO postgres;

--
-- Name: uom_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.uom_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.uom_id_seq OWNER TO postgres;

--
-- Name: uom_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.uom_id_seq OWNED BY public.uom.id;


--
-- Name: user_clipboard; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_clipboard (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    label text NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_clipboard_entity_type_check CHECK ((entity_type = ANY (ARRAY['inventory'::text, 'invoice'::text, 'voucher'::text, 'account'::text, 'customer'::text, 'vendor'::text, 'fixed_asset'::text])))
);


ALTER TABLE public.user_clipboard OWNER TO postgres;

--
-- Name: user_clipboard_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_clipboard_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_clipboard_id_seq OWNER TO postgres;

--
-- Name: user_clipboard_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_clipboard_id_seq OWNED BY public.user_clipboard.id;


--
-- Name: user_dashboard_widgets; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_dashboard_widgets (
    id integer NOT NULL,
    user_id integer NOT NULL,
    widget_key text NOT NULL,
    "position" integer DEFAULT 0,
    is_visible boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.user_dashboard_widgets OWNER TO postgres;

--
-- Name: user_dashboard_widgets_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_dashboard_widgets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_dashboard_widgets_id_seq OWNER TO postgres;

--
-- Name: user_dashboard_widgets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_dashboard_widgets_id_seq OWNED BY public.user_dashboard_widgets.id;


--
-- Name: user_permissions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_permissions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    module character varying(50) NOT NULL,
    permission_key character varying(30) NOT NULL,
    allowed boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.user_permissions OWNER TO postgres;

--
-- Name: user_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_permissions_id_seq OWNER TO postgres;

--
-- Name: user_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_permissions_id_seq OWNED BY public.user_permissions.id;


--
-- Name: user_preferences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_preferences (
    id integer NOT NULL,
    user_id integer NOT NULL,
    pref_key character varying(50) NOT NULL,
    pref_value text
);


ALTER TABLE public.user_preferences OWNER TO postgres;

--
-- Name: user_preferences_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_preferences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_preferences_id_seq OWNER TO postgres;

--
-- Name: user_preferences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_preferences_id_seq OWNED BY public.user_preferences.id;


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_roles (
    id integer NOT NULL,
    user_id integer NOT NULL,
    role_id integer NOT NULL,
    assigned_by integer,
    assigned_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.user_roles OWNER TO postgres;

--
-- Name: user_roles_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_roles_id_seq OWNER TO postgres;

--
-- Name: user_roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_roles_id_seq OWNED BY public.user_roles.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(150),
    password_hash character varying(255) NOT NULL,
    full_name character varying(100) NOT NULL,
    role public.user_role DEFAULT 'operator'::public.user_role NOT NULL,
    department_id integer,
    is_active boolean DEFAULT true,
    last_login timestamp with time zone,
    mfa_secret character varying(64),
    mfa_enabled boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: v_fixed_asset_wdv; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.v_fixed_asset_wdv AS
 SELECT fa.id,
    fa.asset_code,
    fa.asset_name,
    fa.category_id,
    fac.name AS category_name,
    fac.depreciation_rate_pct,
    fac.depreciation_method,
    fa.purchase_cost,
    fa.salvage_value,
    fa.accumulated_depreciation,
    (fa.purchase_cost - fa.accumulated_depreciation) AS wdv_today,
    fa.status,
    fa.in_service_date
   FROM (public.fixed_assets fa
     JOIN public.fixed_asset_categories fac ON ((fa.category_id = fac.id)));


ALTER VIEW public.v_fixed_asset_wdv OWNER TO postgres;

--
-- Name: vendor_advances; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_advances (
    id integer NOT NULL,
    vendor_id integer NOT NULL,
    payment_id integer NOT NULL,
    amount numeric(15,2) NOT NULL,
    remaining_amount numeric(15,2) NOT NULL,
    status character varying(20) DEFAULT 'OPEN'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT vendor_advances_amount_check CHECK ((amount > (0)::numeric))
);


ALTER TABLE public.vendor_advances OWNER TO postgres;

--
-- Name: vendor_advances_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_advances_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendor_advances_id_seq OWNER TO postgres;

--
-- Name: vendor_advances_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_advances_id_seq OWNED BY public.vendor_advances.id;


--
-- Name: vendors; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendors (
    id integer NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(150) NOT NULL,
    category public.vendor_category DEFAULT 'general'::public.vendor_category,
    contact_person character varying(100),
    phone character varying(20),
    email character varying(150),
    address text,
    city character varying(50),
    state character varying(50),
    gstin character varying(22),
    pan character varying(12),
    payment_term character varying(30) DEFAULT 'Immediate'::character varying,
    bank_details text,
    status public.master_status DEFAULT 'active'::public.master_status,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    account_id integer
);


ALTER TABLE public.vendors OWNER TO postgres;

--
-- Name: COLUMN vendors.account_id; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN public.vendors.account_id IS 'Optional AP sub-ledger account in the chart of accounts (accounts.id)';


--
-- Name: vendors_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendors_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vendors_id_seq OWNER TO postgres;

--
-- Name: vendors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendors_id_seq OWNED BY public.vendors.id;


--
-- Name: accounts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.accounts ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);


--
-- Name: api_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.api_logs ALTER COLUMN id SET DEFAULT nextval('public.api_logs_id_seq'::regclass);


--
-- Name: asset_templates id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_templates ALTER COLUMN id SET DEFAULT nextval('public.asset_templates_id_seq'::regclass);


--
-- Name: audit_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log ALTER COLUMN id SET DEFAULT nextval('public.audit_log_id_seq'::regclass);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: bank_deposit_lines id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bank_deposit_lines ALTER COLUMN id SET DEFAULT nextval('public.bank_deposit_lines_id_seq'::regclass);


--
-- Name: bank_deposits id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bank_deposits ALTER COLUMN id SET DEFAULT nextval('public.bank_deposits_id_seq'::regclass);


--
-- Name: bank_reconciliation id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bank_reconciliation ALTER COLUMN id SET DEFAULT nextval('public.bank_reconciliation_id_seq'::regclass);


--
-- Name: bank_reconciliation_lines id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bank_reconciliation_lines ALTER COLUMN id SET DEFAULT nextval('public.bank_reconciliation_lines_id_seq'::regclass);


--
-- Name: code_sequences id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.code_sequences ALTER COLUMN id SET DEFAULT nextval('public.code_sequences_id_seq'::regclass);


--
-- Name: cost_centers id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_centers ALTER COLUMN id SET DEFAULT nextval('public.cost_centers_id_seq'::regclass);


--
-- Name: customer_advances id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_advances ALTER COLUMN id SET DEFAULT nextval('public.customer_advances_id_seq'::regclass);


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: departments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departments ALTER COLUMN id SET DEFAULT nextval('public.departments_id_seq'::regclass);


--
-- Name: depreciation_run_lines id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depreciation_run_lines ALTER COLUMN id SET DEFAULT nextval('public.depreciation_run_lines_id_seq'::regclass);


--
-- Name: depreciation_runs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depreciation_runs ALTER COLUMN id SET DEFAULT nextval('public.depreciation_runs_id_seq'::regclass);


--
-- Name: expense_allocations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expense_allocations ALTER COLUMN id SET DEFAULT nextval('public.expense_allocations_id_seq'::regclass);


--
-- Name: expense_categories id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expense_categories ALTER COLUMN id SET DEFAULT nextval('public.expense_categories_id_seq'::regclass);


--
-- Name: expense_lines id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expense_lines ALTER COLUMN id SET DEFAULT nextval('public.expense_lines_id_seq'::regclass);


--
-- Name: expenses id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses ALTER COLUMN id SET DEFAULT nextval('public.expenses_id_seq'::regclass);


--
-- Name: fixed_asset_categories id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_asset_categories ALTER COLUMN id SET DEFAULT nextval('public.fixed_asset_categories_id_seq'::regclass);


--
-- Name: fixed_asset_gst_ledger id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_asset_gst_ledger ALTER COLUMN id SET DEFAULT nextval('public.fixed_asset_gst_ledger_id_seq'::regclass);


--
-- Name: fixed_assets id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_assets ALTER COLUMN id SET DEFAULT nextval('public.fixed_assets_id_seq'::regclass);


--
-- Name: growth_run_cycles id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.growth_run_cycles ALTER COLUMN id SET DEFAULT nextval('public.growth_run_cycles_id_seq'::regclass);


--
-- Name: inventory id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory ALTER COLUMN id SET DEFAULT nextval('public.inventory_id_seq'::regclass);


--
-- Name: inventory_closing_override id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_closing_override ALTER COLUMN id SET DEFAULT nextval('public.inventory_closing_override_id_seq'::regclass);


--
-- Name: inventory_opening id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_opening ALTER COLUMN id SET DEFAULT nextval('public.inventory_opening_id_seq'::regclass);


--
-- Name: invoice_lines id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_lines ALTER COLUMN id SET DEFAULT nextval('public.invoice_lines_id_seq'::regclass);


--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);


--
-- Name: items id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.items ALTER COLUMN id SET DEFAULT nextval('public.items_id_seq'::regclass);


--
-- Name: je_allocations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.je_allocations ALTER COLUMN id SET DEFAULT nextval('public.je_allocations_id_seq'::regclass);


--
-- Name: je_lines id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.je_lines ALTER COLUMN id SET DEFAULT nextval('public.je_lines_id_seq'::regclass);


--
-- Name: journal_entries id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.journal_entries ALTER COLUMN id SET DEFAULT nextval('public.journal_entries_id_seq'::regclass);


--
-- Name: locations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.locations ALTER COLUMN id SET DEFAULT nextval('public.locations_id_seq'::regclass);


--
-- Name: login_attempts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.login_attempts ALTER COLUMN id SET DEFAULT nextval('public.login_attempts_id_seq'::regclass);


--
-- Name: lot_mix_components id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_mix_components ALTER COLUMN id SET DEFAULT nextval('public.lot_mix_components_id_seq'::regclass);


--
-- Name: lot_movement_children id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_movement_children ALTER COLUMN id SET DEFAULT nextval('public.lot_movement_children_id_seq'::regclass);


--
-- Name: lot_movement_parents id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_movement_parents ALTER COLUMN id SET DEFAULT nextval('public.lot_movement_parents_id_seq'::regclass);


--
-- Name: lot_movements id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_movements ALTER COLUMN id SET DEFAULT nextval('public.lot_movements_id_seq'::regclass);


--
-- Name: lot_op_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_op_log ALTER COLUMN id SET DEFAULT nextval('public.lot_op_log_id_seq'::regclass);


--
-- Name: lot_process_issues id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_process_issues ALTER COLUMN id SET DEFAULT nextval('public.lot_process_issues_id_seq'::regclass);


--
-- Name: lot_process_returns id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_process_returns ALTER COLUMN id SET DEFAULT nextval('public.lot_process_returns_id_seq'::regclass);


--
-- Name: machine_process_lots id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_process_lots ALTER COLUMN id SET DEFAULT nextval('public.machine_process_lots_id_seq'::regclass);


--
-- Name: machine_process_materials id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_process_materials ALTER COLUMN id SET DEFAULT nextval('public.machine_process_materials_id_seq'::regclass);


--
-- Name: machine_processes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_processes ALTER COLUMN id SET DEFAULT nextval('public.machine_processes_id_seq'::regclass);


--
-- Name: machine_status_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_status_logs ALTER COLUMN id SET DEFAULT nextval('public.machine_status_logs_id_seq'::regclass);


--
-- Name: machines id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machines ALTER COLUMN id SET DEFAULT nextval('public.machines_id_seq'::regclass);


--
-- Name: migrations_history id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.migrations_history ALTER COLUMN id SET DEFAULT nextval('public.migrations_history_id_seq'::regclass);


--
-- Name: payment_allocations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_allocations ALTER COLUMN id SET DEFAULT nextval('public.payment_allocations_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: pending_transfer_lots id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pending_transfer_lots ALTER COLUMN id SET DEFAULT nextval('public.pending_transfer_lots_id_seq'::regclass);


--
-- Name: pending_transfers id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pending_transfers ALTER COLUMN id SET DEFAULT nextval('public.pending_transfers_id_seq'::regclass);


--
-- Name: permission_audit_logs id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_audit_logs ALTER COLUMN id SET DEFAULT nextval('public.permission_audit_logs_id_seq'::regclass);


--
-- Name: process_master id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_master ALTER COLUMN id SET DEFAULT nextval('public.process_master_id_seq'::regclass);


--
-- Name: process_return_lines id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_return_lines ALTER COLUMN id SET DEFAULT nextval('public.process_return_lines_id_seq'::regclass);


--
-- Name: process_transaction_lines id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_transaction_lines ALTER COLUMN id SET DEFAULT nextval('public.process_transaction_lines_id_seq'::regclass);


--
-- Name: process_transactions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_transactions ALTER COLUMN id SET DEFAULT nextval('public.process_transactions_id_seq'::regclass);


--
-- Name: purchase_note_lines id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_note_lines ALTER COLUMN id SET DEFAULT nextval('public.purchase_note_lines_id_seq'::regclass);


--
-- Name: purchase_notes id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_notes ALTER COLUMN id SET DEFAULT nextval('public.purchase_notes_id_seq'::regclass);


--
-- Name: receipt_allocations id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.receipt_allocations ALTER COLUMN id SET DEFAULT nextval('public.receipt_allocations_id_seq'::regclass);


--
-- Name: receipts id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.receipts ALTER COLUMN id SET DEFAULT nextval('public.receipts_id_seq'::regclass);


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('public.refresh_tokens_id_seq'::regclass);


--
-- Name: role_permissions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions ALTER COLUMN id SET DEFAULT nextval('public.role_permissions_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: rough_growth id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rough_growth ALTER COLUMN id SET DEFAULT nextval('public.rough_growth_id_seq'::regclass);


--
-- Name: rough_growth_lines id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rough_growth_lines ALTER COLUMN id SET DEFAULT nextval('public.rough_growth_lines_id_seq'::regclass);


--
-- Name: session_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.session_log ALTER COLUMN id SET DEFAULT nextval('public.session_log_id_seq'::regclass);


--
-- Name: stock_transfer id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer ALTER COLUMN id SET DEFAULT nextval('public.stock_transfer_id_seq'::regclass);


--
-- Name: stock_transfer_items id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer_items ALTER COLUMN id SET DEFAULT nextval('public.stock_transfer_items_id_seq'::regclass);


--
-- Name: uom id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.uom ALTER COLUMN id SET DEFAULT nextval('public.uom_id_seq'::regclass);


--
-- Name: user_clipboard id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_clipboard ALTER COLUMN id SET DEFAULT nextval('public.user_clipboard_id_seq'::regclass);


--
-- Name: user_dashboard_widgets id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_dashboard_widgets ALTER COLUMN id SET DEFAULT nextval('public.user_dashboard_widgets_id_seq'::regclass);


--
-- Name: user_permissions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_permissions ALTER COLUMN id SET DEFAULT nextval('public.user_permissions_id_seq'::regclass);


--
-- Name: user_preferences id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_preferences ALTER COLUMN id SET DEFAULT nextval('public.user_preferences_id_seq'::regclass);


--
-- Name: user_roles id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles ALTER COLUMN id SET DEFAULT nextval('public.user_roles_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: vendor_advances id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_advances ALTER COLUMN id SET DEFAULT nextval('public.vendor_advances_id_seq'::regclass);


--
-- Name: vendors id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendors ALTER COLUMN id SET DEFAULT nextval('public.vendors_id_seq'::regclass);


--
-- Data for Name: accounts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.accounts (id, code, name, type, parent_id, is_group, currency, balance, status, description, created_at, updated_at, sub_type, level, path, is_posting) FROM stdin;
\.


--
-- Data for Name: api_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.api_logs (id, method, endpoint, status_code, response_time_ms, ip_address, user_id, request_body, error_message, created_at) FROM stdin;
\.


--
-- Data for Name: asset_templates; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.asset_templates (id, code, name, category_id, default_model_no, default_brand, default_manufacturer, default_uom_id, default_useful_life, default_depr_rate, description, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.audit_log (id, table_name, record_id, action, old_data, new_data, changed_by, changed_at) FROM stdin;
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.audit_logs (id, "timestamp", user_id, action, table_name, record_id, old_values, new_values, ip_address, user_agent, duration_ms, status_code) FROM stdin;
\.


--
-- Data for Name: bank_deposit_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bank_deposit_lines (id, deposit_id, party_name, account_id, description, amount, payment_method, ref_no, created_at, received_from_type, received_from_id) FROM stdin;
\.


--
-- Data for Name: bank_deposits; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bank_deposits (id, date, bank_account_id, total_amount, memo, je_id, created_by, created_at, updated_at, status, reverse_je_id, doc_number) FROM stdin;
\.


--
-- Data for Name: bank_reconciliation; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bank_reconciliation (id, account_id, statement_date, statement_balance, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: bank_reconciliation_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.bank_reconciliation_lines (id, reconciliation_id, je_id, system_amount, bank_amount, match_status, bank_date, bank_ref) FROM stdin;
\.


--
-- Data for Name: code_sequences; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.code_sequences (id, entity_type, prefix, separator, period_scope, padding, next_value, format_pattern, editable_policy, description, active, created_at, updated_at) FROM stdin;
6	customer	CST	-	none	4	1	PREFIX-SEQ	auto	Auto-generated customer codes (CST-0001)	t	2026-06-08 17:58:04.606701+05:30	2026-06-08 17:58:04.606701+05:30
7	fixed_asset	FA	-	none	4	1	PREFIX-YYYY-SEQ	auto	Auto-generated fixed asset codes (FA-2026-0001)	t	2026-06-08 17:58:04.606701+05:30	2026-06-08 17:58:04.606701+05:30
8	bank_deposit	BD	-	none	4	1	PREFIX-YYYYMM-SEQ	auto	Auto-generated bank deposit numbers (BD-202606-0001)	t	2026-06-08 17:58:04.606701+05:30	2026-06-08 17:58:04.606701+05:30
11	machine	MAC-	-	none	4	1	PREFIX-SEQ	auto	Machine ID	t	2026-06-08 18:00:16.370893+05:30	2026-06-08 18:00:16.370893+05:30
13	purchase_order	PO-	-	none	5	1	PREFIX-SEQ	auto	Purchase Order ID	t	2026-06-08 18:00:16.371834+05:30	2026-06-08 18:00:16.371834+05:30
14	sales_order	SO-	-	none	5	1	PREFIX-SEQ	auto	Sales Order ID	t	2026-06-08 18:00:16.372318+05:30	2026-06-08 18:00:16.372318+05:30
15	journal_entry	JE-	-	none	5	1	PREFIX-SEQ	auto	Journal Entry ID	t	2026-06-08 18:00:16.372771+05:30	2026-06-08 18:00:16.372771+05:30
16	expense	EXP-	-	none	5	1	PREFIX-SEQ	auto	Expense ID	t	2026-06-08 18:00:16.373152+05:30	2026-06-08 18:00:16.373152+05:30
17	payment	PAY-	-	none	5	1	PREFIX-SEQ	auto	Payment ID	t	2026-06-08 18:00:16.3735+05:30	2026-06-08 18:00:16.3735+05:30
18	receipt	REC-	-	none	5	1	PREFIX-SEQ	auto	Receipt ID	t	2026-06-08 18:00:16.373857+05:30	2026-06-08 18:00:16.373857+05:30
20	process	PRC-	-	none	5	1	PREFIX-SEQ	auto	Process ID	t	2026-06-08 18:00:16.374349+05:30	2026-06-08 18:00:16.374349+05:30
21	batch	BCH-	-	none	5	1	PREFIX-SEQ	auto	Batch ID	t	2026-06-08 18:00:16.374564+05:30	2026-06-08 18:00:16.374564+05:30
22	lot	LOT-	-	none	5	1	PREFIX-SEQ	auto	Lot ID	t	2026-06-08 18:00:16.374777+05:30	2026-06-08 18:00:16.374777+05:30
23	item	ITM-	-	none	5	1	PREFIX-SEQ	auto	Item Code	t	2026-06-08 18:00:16.374983+05:30	2026-06-08 18:00:16.374983+05:30
24	manufacturing.process.started	MFG-	-	none	5	1	PREFIX-SEQ	auto	Manufacturing Process	t	2026-06-08 18:00:16.375309+05:30	2026-06-08 18:00:16.375309+05:30
25	inventory.transferred	TRN-	-	none	5	1	PREFIX-SEQ	auto	Transfer ID	t	2026-06-08 18:00:16.375648+05:30	2026-06-08 18:00:16.375648+05:30
26	inventory.adjusted	ADJ-	-	none	5	1	PREFIX-SEQ	auto	Adjustment ID	t	2026-06-08 18:00:16.376028+05:30	2026-06-08 18:00:16.376028+05:30
27	return	RET-	-	none	5	1	PREFIX-SEQ	auto	Return ID	t	2026-06-08 18:00:16.376371+05:30	2026-06-08 18:00:16.376371+05:30
5	vendor	VND	-	none	4	66	PREFIX-SEQ	auto	Auto-generated vendor codes (VND-0001)	t	2026-06-08 17:58:04.606701+05:30	2026-06-09 10:29:11.510843+05:30
\.


--
-- Data for Name: cost_centers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.cost_centers (id, name, code, status, created_at) FROM stdin;
\.


--
-- Data for Name: customer_advances; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customer_advances (id, customer_id, receipt_id, amount, remaining_amount, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.customers (id, code, name, contact_person, phone, email, address, city, state, gstin, pan, payment_term, credit_limit, outstanding, status, created_at, updated_at, account_id) FROM stdin;
\.


--
-- Data for Name: departments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.departments (id, code, name, head, location_id, staff_count, status, created_at, updated_at) FROM stdin;
7	DP01	Ichapore Factory	Vishwash	4	0	active	2026-06-03 15:55:11.928533+05:30	2026-06-04 10:30:42.524239+05:30
8	DP02	Admin	\N	4	0	active	2026-06-04 10:32:53.181396+05:30	2026-06-04 10:32:53.181396+05:30
9	DP03	Purchase	\N	4	0	active	2026-06-04 10:33:43.990062+05:30	2026-06-04 10:33:43.990062+05:30
\.


--
-- Data for Name: depreciation_run_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.depreciation_run_lines (id, run_id, fixed_asset_id, opening_wdv, depreciation_amount, closing_wdv, days_in_period) FROM stdin;
\.


--
-- Data for Name: depreciation_runs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.depreciation_runs (id, run_number, period_from, period_to, je_id, total_amount, status, remarks, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: expense_allocations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.expense_allocations (id, expense_id, purchase_note_id, amount, allocated_date, created_at) FROM stdin;
\.


--
-- Data for Name: expense_categories; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.expense_categories (id, code, name, gl_account_id, monthly_budget, status, created_at) FROM stdin;
\.


--
-- Data for Name: expense_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.expense_lines (id, expense_id, seq, category_id, description, department_id, cost_center_id, amount, gl_account_id, created_at) FROM stdin;
\.


--
-- Data for Name: expenses; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.expenses (id, doc_number, date, category_id, description, amount, paid_via, payment_account_id, reference_no, department_id, je_id, status, created_by, created_at, updated_at, vendor_id, payment_mode, memo) FROM stdin;
\.


--
-- Data for Name: fixed_asset_categories; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.fixed_asset_categories (id, code, name, depreciation_rate_pct, depreciation_method, useful_life_years, gl_asset_account_id, gl_accum_depr_account_id, gl_depr_expense_account_id, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: fixed_asset_gst_ledger; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.fixed_asset_gst_ledger (id, fixed_asset_id, vendor_id, invoice_no, invoice_date, taxable_value, cgst_amount, sgst_amount, igst_amount, gst_claimable_amount, gst_non_claimable_amount, total_invoice_value, treatment, remarks, created_at) FROM stdin;
\.


--
-- Data for Name: fixed_assets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.fixed_assets (id, asset_code, asset_name, category_id, purchase_note_id, purchase_note_line_id, vendor_id, location_id, department_id, purchase_date, in_service_date, invoice_no, invoice_date, taxable_value, gst_rate, cgst_amount, sgst_amount, igst_amount, gst_claimable_amount, gst_non_claimable_amount, gst_treatment, total_invoice_value, purchase_cost, salvage_value, accumulated_depreciation, status, disposal_date, disposal_value, remarks, created_by, created_at, updated_at, serial_no, model_no, brand, manufacturer, qty, uom_id, asset_tag, condition, warranty_expiry, installation_date, custodian, template_id) FROM stdin;
\.


--
-- Data for Name: growth_run_cycles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.growth_run_cycles (id, growth_run_id, machine_process_id, cycle_no, process_type, prev_height, new_height, growth_mm, prev_weight, new_weight, weight_delta, dim_length, dim_width, dim_unit, remarks, performed_by, created_at) FROM stdin;
\.


--
-- Data for Name: inventory; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inventory (id, item_id, lot_number, lot_name, batch_no, qty, unit, weight, rate, total_value, location_id, department_id, vendor_id, purchase_date, last_used, status, remarks, created_at, updated_at, source_movement_id, source_type, lot_code, parent_lot_id, root_lot_id, operation_type, split_level, genealogy_path, lot_op_id, dim_length, dim_depth, dim_height, dim_unit, source_module, machine_process_id, seed_height_at_in, weight_at_in, version) FROM stdin;
\.


--
-- Data for Name: inventory_closing_override; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inventory_closing_override (id, date, item_id, quantity, rate, value, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: inventory_opening; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.inventory_opening (id, item_id, quantity, rate, value, as_of_date, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: invoice_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.invoice_lines (id, invoice_id, line_no, inventory_id, lot_number, lot_name, qty, weight, color, clarity, rate_per_carat, amount, cost_value, created_at) FROM stdin;
\.


--
-- Data for Name: invoices; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.invoices (id, doc_number, doc_date, invoice_type, customer_id, payment_term, currency, reference_no, remark, total_qty, total_weight, sub_total, tax_pct, tax_amount, grand_total, amount_paid, balance_due, je_id, cogs_je_id, status, payment_status, created_by, created_at, updated_at, version) FROM stdin;
\.


--
-- Data for Name: invoices_old; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.invoices_old (id, doc_number, doc_date, invoice_type, customer_id, payment_term, currency, reference_no, remark, total_qty, total_weight, sub_total, tax_pct, tax_amount, grand_total, amount_paid, balance_due, je_id, cogs_je_id, status, payment_status, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.items (id, code, name, category, type, default_uom, hsn_code, reorder_level, description, status, created_at, updated_at, is_capital_asset, fixed_asset_category_id, quantity_on_hand, avg_cost, last_purchase_cost, inventory_value) FROM stdin;
23	seed	seed	seed	raw_material	PCS	\N	0	\N	active	2026-06-08 18:34:25.886164+05:30	2026-06-09 13:06:01.216822+05:30	f	\N	5637.0000	4395.8921	5164.0000	24779644.00
\.


--
-- Data for Name: je_allocations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.je_allocations (id, entity_type, entity_id, je_id, je_line_id, target_type, target_id, allocated_amount, allocation_date, notes, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: je_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.je_lines (id, je_id, account_id, debit, credit, narration, created_at, cost_center_id, entity_type, entity_id, reference_no) FROM stdin;
\.


--
-- Data for Name: je_lines_old; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.je_lines_old (id, je_id, account_id, debit, credit, narration, created_at, cost_center_id, entity_type, entity_id, reference_no) FROM stdin;
\.


--
-- Data for Name: journal_entries; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.journal_entries (id, je_number, date, description, source_type, source_id, total_debit, total_credit, status, posted_at, created_by, created_at, updated_at, reference_no, reversal_of_je_id, is_reversed, reversed_at, reversed_by) FROM stdin;
\.


--
-- Data for Name: journal_entries_old; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.journal_entries_old (id, je_number, date, description, source_type, source_id, total_debit, total_credit, status, posted_at, created_by, created_at, updated_at, reference_no, reversal_of_je_id, is_reversed, reversed_at, reversed_by) FROM stdin;
\.


--
-- Data for Name: locations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.locations (id, code, name, type, address, city, state, manager, status, created_at, updated_at) FROM stdin;
4	001	Ichapore Factory	factory	\N	Surat	Gujarat	\N	active	2026-06-04 10:29:38.131089+05:30	2026-06-04 10:31:53.5143+05:30
\.


--
-- Data for Name: login_attempts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.login_attempts (id, username, ip_address, success, created_at) FROM stdin;
69	superadmin	::ffff:192.168.1.211	t	2026-06-09 14:36:29.008379+05:30
70	superadmin	::1	t	2026-06-09 16:13:28.571992+05:30
\.


--
-- Data for Name: lot_mix_components; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lot_mix_components (id, mixed_lot_id, source_lot_id, qty, created_at) FROM stdin;
\.


--
-- Data for Name: lot_movement_children; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lot_movement_children (id, movement_id, child_lot_id, quantity, cost_per_unit) FROM stdin;
\.


--
-- Data for Name: lot_movement_parents; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lot_movement_parents (id, movement_id, parent_lot_id, quantity_consumed, cost_per_unit) FROM stdin;
\.


--
-- Data for Name: lot_movements; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lot_movements (id, movement_number, movement_type, movement_date, notes, created_by, created_at) FROM stdin;
17	LM-202606-1014	mix	2026-06-09	\N	6	2026-06-09 10:37:45.512748+05:30
\.


--
-- Data for Name: lot_movements_old; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lot_movements_old (id, movement_number, movement_type, movement_date, notes, created_by, created_at) FROM stdin;
\.


--
-- Data for Name: lot_op_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lot_op_log (id, lot_id, operation, reference_type, reference_id, qty_delta, new_status, notes, performed_by, performed_at) FROM stdin;
\.


--
-- Data for Name: lot_process_issues; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lot_process_issues (id, issue_number, source_lot_id, process_lot_id, issued_qty, issue_date, expected_return, department, operator, remarks, status, created_by, created_at, updated_at, machine_id, operator_id, machine_process_id, process_type, target_runtime_hours, expected_rough_qty, remaining_in_process) FROM stdin;
\.


--
-- Data for Name: lot_process_returns; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lot_process_returns (id, return_number, issue_id, return_date, usable_qty, damaged_qty, consumed_qty, remarks, created_by, created_at, is_final, remaining_after) FROM stdin;
\.


--
-- Data for Name: machine_process_lots; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.machine_process_lots (id, process_id, inventory_lot_id, issued_qty, issued_weight, returned_qty, damaged_qty, consumed_qty) FROM stdin;
\.


--
-- Data for Name: machine_process_materials; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.machine_process_materials (id, process_id, material_id, material_name, qty, unit) FROM stdin;
\.


--
-- Data for Name: machine_processes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.machine_processes (id, process_number, machine_id, operator_id, process_type, status, started_at, paused_at, completed_at, target_runtime_hours, expected_completion_at, total_paused_minutes, expected_rough_qty, expected_height, remarks, created_by, created_at, output_entry_id, output_completed_at, actual_output_qty, actual_yield_pct) FROM stdin;
\.


--
-- Data for Name: machine_status_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.machine_status_logs (id, machine_id, old_status, new_status, changed_at, changed_by, remarks) FROM stdin;
\.


--
-- Data for Name: machines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.machines (id, code, name, type, department_id, location_id, capacity, last_service, next_service, status, created_at, updated_at) FROM stdin;
14	CVD-M-09	SSD-009	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
15	CVD-M-10	SSD-010	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
16	CVD-M-11	SSD-011	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
17	CVD-M-12	SSD-012	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
18	CVD-M-13	SSD-013	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
19	CVD-M-14	SSD-014	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
20	CVD-M-15	SSD-015	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
21	CVD-M-16	SSD-016	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
22	CVD-M-17	SSD-017	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
23	CVD-M-18	SSD-018	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
24	CVD-M-19	SSD-019	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
25	CVD-M-20	SSD-020	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
26	CVD-M-21	SSD-021	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
27	CVD-M-22	SSD-022	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
28	CVD-M-23	SSD-023	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
29	CVD-M-24	SSD-024	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
30	CVD-M-25	SSD-025	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
31	CVD-M-26	SSD-026	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
32	CVD-M-27	SSD-027	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
33	CVD-M-28	SSD-028	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
34	CVD-M-29	SSD-029	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
35	CVD-M-30	SSD-030	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
36	CVD-M-31	SSD-031	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
37	CVD-M-32	SSD-032	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
38	CVD-M-33	SSD-033	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
39	CVD-M-34	SSD-034	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
40	CVD-M-35	SSD-035	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
41	CVD-M-36	SSD-036	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
42	CVD-M-37	SSD-037	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
43	CVD-M-38	SSD-038	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
44	CVD-M-39	SSD-039	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
45	CVD-M-40	SSD-040	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
46	CVD-M-41	SSD-041	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
47	CVD-M-42	SSD-042	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
48	CVD-M-43	SSD-043	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
49	CVD-M-44	SSD-044	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
50	CVD-M-45	SSD-045	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
51	CVD-M-46	SSD-046	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
52	CVD-M-47	SSD-047	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
53	CVD-M-48	SSD-048	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
54	CVD-M-49	SSD-049	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
55	CVD-M-50	SSD-050	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
56	CVD-M-51	SSD-051	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
57	CVD-M-52	SSD-052	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
58	CVD-M-53	SSD-053	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
59	CVD-M-54	SSD-054	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
60	CVD-M-55	SSD-055	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
61	CVD-M-56	SSD-056	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
62	CVD-M-57	SSD-057	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
63	CVD-M-58	SSD-058	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
64	CVD-M-59	SSD-059	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
65	CVD-M-60	SSD-060	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
66	CVD-M-61	SSD-061	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
67	CVD-M-62	SSD-062	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
68	CVD-M-63	SSD-063	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
69	CVD-M-64	SSD-064	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
70	CVD-M-65	SSD-065	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
71	CVD-M-66	SSD-066	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
72	CVD-M-67	SSD-067	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
73	CVD-M-68	SSD-068	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
74	CVD-M-69	SSD-069	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
75	CVD-M-70	SSD-070	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
76	CVD-M-71	SSD-071	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
77	CVD-M-72	SSD-072	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
78	CVD-M-73	SSD-073	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
79	CVD-M-74	SSD-074	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
80	CVD-M-75	SSD-075	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
11	CVD-M-06	SSD-006	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 15:07:57.267668+05:30
12	CVD-M-07	SSD-007	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 15:07:57.267668+05:30
10	CVD-M-05	SSD-005	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-04 17:18:39.075083+05:30
8	CVD-M-03	SSD-003	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-04 17:30:01.147095+05:30
6	CVD-M-01	SSD-001	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-05 16:25:43.225623+05:30
7	CVD-M-02	SSD-002	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-05 19:57:49.727989+05:30
9	CVD-M-04	SSD-004	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-05 20:02:03.374901+05:30
81	CVD-M-76	SSD-076	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
82	CVD-M-77	SSD-077	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
83	CVD-M-78	SSD-078	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
84	CVD-M-79	SSD-079	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
85	CVD-M-80	SSD-080	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
86	CVD-M-81	SSD-081	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
87	CVD-M-82	SSD-082	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
88	CVD-M-83	SSD-083	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
89	CVD-M-84	SSD-084	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
90	CVD-M-85	SSD-085	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
91	CVD-M-86	SSD-086	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
92	CVD-M-87	SSD-087	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
93	CVD-M-88	SSD-088	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
94	CVD-M-89	SSD-089	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
95	CVD-M-90	SSD-090	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
96	CVD-M-91	SSD-091	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
97	CVD-M-92	SSD-092	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
98	CVD-M-93	SSD-093	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
99	CVD-M-94	SSD-094	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
100	CVD-M-95	SSD-095	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
101	CVD-M-96	SSD-096	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
102	CVD-M-97	SSD-097	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
103	CVD-M-98	SSD-098	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
104	CVD-M-99	SSD-099	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
105	CVD-M-100	SSD-100	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
106	CVD-M-101	SSD-101	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
107	CVD-M-102	SSD-102	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
108	CVD-M-103	SSD-103	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
109	CVD-M-104	SSD-104	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
110	CVD-M-105	SSD-105	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
111	CVD-M-106	SSD-106	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
112	CVD-M-107	SSD-107	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
113	CVD-M-108	SSD-108	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
114	CVD-M-109	SSD-109	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
115	CVD-M-110	SSD-110	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
116	CVD-M-111	SSD-111	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
117	CVD-M-112	SSD-112	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
118	CVD-M-113	SSD-113	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
119	CVD-M-114	SSD-114	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
120	CVD-M-115	SSD-115	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
121	CVD-M-116	SSD-116	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30
13	CVD-M-08	SSD-008	CVD Reactor	\N	\N	\N	2026-04-01	2026-10-01	idle	2026-06-03 11:50:15.677566+05:30	2026-06-03 15:07:57.267668+05:30
126	FB-M-05	LS-05	Laser	\N	\N	\N	2026-04-01	2026-10-10	idle	2026-06-03 17:24:43.277752+05:30	2026-06-03 18:43:20.902091+05:30
124	FB-M-03	LS-03	Laser	\N	\N	\N	2026-04-01	2026-10-10	idle	2026-06-03 17:22:46.68676+05:30	2026-06-05 09:48:22.924391+05:30
125	FB-M-04	LS-04	Laser	\N	\N	\N	2026-04-01	2026-10-10	idle	2026-06-03 17:23:57.562195+05:30	2026-06-05 19:37:59.400611+05:30
123	FB-M-02	LS-02	Laser	\N	\N	\N	2026-04-01	2026-10-10	idle	2026-06-03 17:21:21.000151+05:30	2026-06-05 20:06:46.92798+05:30
122	FB-M-01	LS-01	Laser	\N	\N	\N	2026-04-01	2026-10-10	idle	2026-06-03 16:42:27.892726+05:30	2026-06-09 10:38:11.455742+05:30
\.


--
-- Data for Name: migrations_history; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.migrations_history (id, filename, applied_at) FROM stdin;
1	add_dashboard_widgets.sql	2026-06-03 18:15:35.612076+05:30
2	bank_recon_migration.sql	2026-06-03 18:15:35.615955+05:30
3	cost_center_migration.sql	2026-06-03 18:15:35.625795+05:30
4	depreciation_indexes.sql	2026-06-03 18:16:16.620673+05:30
9	enterprise_partitioning.sql	2026-06-03 18:16:39.407647+05:30
10	perf_indexes.sql	2026-06-03 18:16:39.408654+05:30
11	phase19_je_entity_migration.sql	2026-06-03 18:16:39.408973+05:30
12	phase20_bill_allocation_engine.sql	2026-06-03 18:16:39.40923+05:30
13	phase21_je_reversal_columns.sql	2026-06-03 18:16:39.409504+05:30
14	phase27_manufacturing_control_tower.sql	2026-06-03 18:16:39.409775+05:30
15	phase28_start_process_workflow.sql	2026-06-03 18:16:39.409978+05:30
16	phase29-stock-transfer.sql	2026-06-03 18:16:39.410179+05:30
17	phase29_process_master.sql	2026-06-03 18:16:39.410353+05:30
18	phase30_process_number_seq.sql	2026-06-03 18:16:39.410505+05:30
19	phase30_return_engine.sql	2026-06-03 18:16:39.410657+05:30
20	phase31_5_output_lifecycle.sql	2026-06-03 18:16:39.411103+05:30
21	phase31_allow_multiple_returns.sql	2026-06-03 18:16:39.411373+05:30
22	phase32_growth_run.sql	2026-06-03 18:16:39.411582+05:30
23	phase32_security_mfa_columns.sql	2026-06-03 18:16:39.411755+05:30
24	phase33_user_department.sql	2026-06-03 18:16:39.411908+05:30
25	phase34_process_group.sql	2026-06-03 18:16:39.412054+05:30
26	phase35-rbac.sql	2026-06-03 18:16:39.412188+05:30
27	phase36-submodule-permissions.sql	2026-06-03 18:16:39.41232+05:30
28	phase37-source-module.sql	2026-06-03 18:16:39.412454+05:30
29	phase38-super-admin-role.sql	2026-06-03 18:16:39.412627+05:30
30	phase35_growth_run_cycles.sql	2026-06-05 18:00:56.819825+05:30
31	phase39_realtime_sync.sql	2026-06-05 18:00:56.824346+05:30
32	phase40_realtime_infrastructure.sql	2026-06-08 14:11:58.147237+05:30
\.


--
-- Data for Name: payment_allocations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payment_allocations (id, payment_id, purchase_note_id, amount, created_at) FROM stdin;
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.payments (id, doc_number, date, vendor_id, amount, payment_mode, bank_account_id, reference_no, cheque_no, cheque_date, remark, purchase_note_id, je_id, status, created_by, created_at, updated_at, advance_amount) FROM stdin;
\.


--
-- Data for Name: pending_transfer_lots; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.pending_transfer_lots (id, pending_transfer_id, lot_id, transfer_qty) FROM stdin;
\.


--
-- Data for Name: pending_transfers; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.pending_transfers (id, transfer_id, source_location_id, destination_location_id, source_account_name, dest_account_name, status, created_at, created_by, approved_by, approved_at, dest_location_name) FROM stdin;
\.


--
-- Data for Name: permission_audit_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.permission_audit_logs (id, user_id, action, target_type, target_id, changes, ip_address, user_agent, created_at) FROM stdin;
\.


--
-- Data for Name: process_master; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.process_master (id, process_code, process_name, category, requires_inventory, requires_machine, requires_operator, requires_runtime, requires_expected_yield, allows_consumables, output_type, default_runtime_hours, sort_order, active, created_at, updated_at, completion_mode, process_group, input_item_category, eligible_machine_type) FROM stdin;
\.


--
-- Data for Name: process_return_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.process_return_lines (id, return_id, return_type, qty, lot_id, lot_code, remarks, created_at) FROM stdin;
\.


--
-- Data for Name: process_transaction_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.process_transaction_lines (id, process_trs_id, inventory_id, lot_number, lot_name, item_type, qty_in, wt_in, qty_out, wt_out, yield_pct, next_process, remark, created_at) FROM stdin;
\.


--
-- Data for Name: process_transactions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.process_transactions (id, trs_number, trs_type, trs_date, process_name, machine_id, department_id, worker_name, expected_return, priority, remark, send_ref_id, return_status, total_qty_in, total_wt_in, total_qty_out, total_wt_out, parameters, je_id, status, created_by, created_at, updated_at, version) FROM stdin;
\.


--
-- Data for Name: purchase_note_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.purchase_note_lines (id, purchase_note_id, line_no, item_id, description, batch_no, qty, unit, rate, amount, tax_pct, tax_amount, total, inventory_id, created_at, is_capital) FROM stdin;
\.


--
-- Data for Name: purchase_notes; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.purchase_notes (id, doc_number, doc_date, vendor_id, item_type, department_id, payment_term, currency, reference_no, remark, total_qty, total_amount, tax_amount, grand_total, je_id, status, created_by, created_at, updated_at, amount_paid, balance_due, payment_status, version) FROM stdin;
\.


--
-- Data for Name: purchase_notes_old; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.purchase_notes_old (id, doc_number, doc_date, vendor_id, item_type, department_id, payment_term, currency, reference_no, remark, total_qty, total_amount, tax_amount, grand_total, je_id, status, created_by, created_at, updated_at, amount_paid, balance_due, payment_status) FROM stdin;
\.


--
-- Data for Name: receipt_allocations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.receipt_allocations (id, receipt_id, invoice_id, amount, created_at) FROM stdin;
\.


--
-- Data for Name: receipts; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.receipts (id, doc_number, date, customer_id, amount, payment_mode, bank_account_id, reference_no, cheque_no, cheque_date, remark, invoice_id, je_id, status, created_by, created_at, updated_at, advance_amount) FROM stdin;
\.


--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.refresh_tokens (id, user_id, expires_at, created_at, token_hash, used_at) FROM stdin;
1	8	2026-06-15 14:33:48.541+05:30	2026-06-08 14:33:47.642388+05:30	4525764eaf85ed6228a433157d31cf85f6687114badf96a218c5a2cf3fcf3ae0	\N
2	6	2026-06-15 14:34:05.581+05:30	2026-06-08 14:34:05.582904+05:30	234d07527ef9c894660e41982a8e09b059c68088f8f6510959d834776193daa3	\N
3	6	2026-06-15 14:39:38.095+05:30	2026-06-08 14:39:38.096104+05:30	1103acca6d89c406b7197d4594c29966e08d84b2520ce0197878edc415d181aa	\N
4	8	2026-06-15 14:44:57.478+05:30	2026-06-08 14:44:56.554102+05:30	2827a41238c849bea47a1481ef9d287a8528d8e5b6c658407279e7ef997eb4fe	\N
5	8	2026-06-15 14:45:02.323+05:30	2026-06-08 14:45:01.399567+05:30	054d4641075a192b81600179f9979e476282423c0da8aaeb185e867f2c3bd169	\N
6	8	2026-06-15 14:46:37.153+05:30	2026-06-08 14:46:36.22496+05:30	fa36f7efc3731f79623eaebccfc8f1a8437cb31ccf2e4593a4402476d401bc85	\N
7	8	2026-06-15 14:47:20.893+05:30	2026-06-08 14:47:19.962273+05:30	d10265b84e92ff015897fd50b95d8e9e821932c9e21713df4d6c1f19ea955df1	\N
8	8	2026-06-15 14:48:32.546+05:30	2026-06-08 14:48:31.613414+05:30	603555f375466b8e47e967d3e9ade2192e4cce9bd2e164e60858ab28399b2123	\N
9	8	2026-06-15 14:51:19.666+05:30	2026-06-08 14:51:18.72847+05:30	52e4b1878b53ae8c1d3f47da2f221874c127f060aeeb3576f1b76285a2e549dd	\N
10	8	2026-06-15 15:06:49.232+05:30	2026-06-08 15:06:48.266186+05:30	b64a33ace15adee71f62fec9de846e1a5ea3b357f6bb73585e29a5dbcce58cdc	\N
11	8	2026-06-15 15:28:14.648+05:30	2026-06-08 15:28:13.64661+05:30	5f20d28a01ccd0f3bf6e622c7296d721db95b32a7e005f0020ad502104d810f0	\N
12	8	2026-06-15 15:29:19.241+05:30	2026-06-08 15:29:18.23814+05:30	44f79442c8059c28321d81f7953485baa95b4a6c0bc8c95e632ebd3132c9bbdd	\N
13	8	2026-06-15 15:29:48.63+05:30	2026-06-08 15:29:47.626516+05:30	a21a147ed1eb3262fc8c0677f541530a5722739c94c9664f5dc1cbe16b9e1e45	\N
14	8	2026-06-15 15:31:51.386+05:30	2026-06-08 15:31:50.380389+05:30	9d8a99d9ecdd027f5aa7e1fdadcf0bd393ee1cef154997afcddd51eca6258074	\N
15	8	2026-06-15 15:31:58.52+05:30	2026-06-08 15:31:57.513567+05:30	48618767fda3a0bde9cc2799922daf76ebb71e4970efc8e61f29d5c30b310303	\N
16	6	2026-06-15 16:08:11.804+05:30	2026-06-08 16:08:11.80487+05:30	8571c01cf5d8ab1fe4cbb25e95dd64d78c11d4f5c2b5b3ced4a8ae7b6825330e	\N
17	6	2026-06-15 16:08:32.776+05:30	2026-06-08 16:08:32.77692+05:30	584f1c4e50cd9aaeeb2f39e3bdfef25cabae978dd78e031d9690f68f6a8da75c	\N
18	6	2026-06-15 17:24:09.048+05:30	2026-06-08 17:24:09.049061+05:30	c6cd9c223b1576323a5b0434286b45f3c5be7eb1964e553d2853d030efe4c74e	\N
19	6	2026-06-15 17:27:11.905+05:30	2026-06-08 17:27:11.905826+05:30	a0af50d75c65d4c0e0e2802048d0a4b60ec8e955c84db1fe6f67e0f67c0ff80b	\N
20	8	2026-06-15 17:36:56.315+05:30	2026-06-08 17:36:55.160175+05:30	6f8e51896aa7475808963118d79b1970e9b89822e840a2d65a32c1371779b941	\N
21	6	2026-06-15 18:09:05.363+05:30	2026-06-08 18:09:05.364824+05:30	e95f9b38f8483694576482746e5365d32811bb765edddc12315a46d8b5cc6085	\N
22	6	2026-06-16 09:16:03.394+05:30	2026-06-09 09:16:03.394477+05:30	a66c846feab5aefd48a956bc3c38fb4e871d562314004eda6d25d5e669e11d27	\N
23	6	2026-06-16 09:16:35.809+05:30	2026-06-09 09:16:35.810411+05:30	834195c595e8213eb65cae063852a8908c874d925638ec730742eb93f19776fa	\N
24	6	2026-06-16 09:28:24.265+05:30	2026-06-09 09:28:24.266642+05:30	59c00347f6fd4db018bf25fa063179e760df7b100ebf8f40895f07a11a041ad2	\N
25	6	2026-06-16 10:11:56.838+05:30	2026-06-09 10:11:56.839273+05:30	8decf1e90ad9906f24a8619562d3314f7357bc5b009f9f9e03d2e0da2c50f9bd	\N
26	6	2026-06-16 10:12:46.704+05:30	2026-06-09 10:12:46.704311+05:30	30c00d164eef915c2d772803f7410e4c52d0aa4aa1398250f7625d07472d7ffc	\N
27	6	2026-06-16 10:12:56.638+05:30	2026-06-09 10:12:56.63869+05:30	6d78db1de24c3c2ae87ba607aeb8a36494723b0375cafdfe0621dc8d9a7dd8ac	\N
28	6	2026-06-16 10:22:26.997+05:30	2026-06-09 10:22:26.998317+05:30	74bf56c5317d113c884bbb7b994e7f86da4b7cbb7f848a76ed2036402e90c552	\N
29	6	2026-06-16 10:22:40.205+05:30	2026-06-09 10:22:40.206036+05:30	cee5b494675eab7a4b70da8a26833caa125cddd6d25a059f09f11b2f2a976798	\N
30	6	2026-06-16 10:23:07.719+05:30	2026-06-09 10:23:07.720112+05:30	bf8569f35cdbb899ec7f081faae8333a75a93c26f315f548e4119853e7eb80fe	\N
31	6	2026-06-16 10:23:24.269+05:30	2026-06-09 10:23:24.270279+05:30	bbe34453ba34e3fcabe212cf849884cfcffd7d5d53c605d9df5d757494dba8eb	\N
32	6	2026-06-16 10:38:51.279+05:30	2026-06-09 10:38:51.279633+05:30	531d1549d45fd0f1f0405c7f9e9c072630cd20d663dc4f4931483d0740e2d444	\N
33	6	2026-06-16 12:25:25.033+05:30	2026-06-09 12:25:25.033894+05:30	20b39675b5daaa1065c7581a49c3a247c051d513ef8b0a16ee5fc3080e3f7526	\N
34	6	2026-06-16 12:26:12.567+05:30	2026-06-09 12:26:12.567631+05:30	bf22913f2a831574c3b12d1c294e0db62a0d2df776345727775e8e58e200bbf0	\N
35	6	2026-06-16 12:58:22.203+05:30	2026-06-09 12:58:22.203585+05:30	8b93af8a6597b619afeb1f39b3773a064a1ea39d4120de1293088261331d3ef3	\N
36	6	2026-06-16 12:59:02.252+05:30	2026-06-09 12:59:02.252861+05:30	41b76a24e1296d367777209258c0e9f5661c9eee1923508f2f0af132b9fed756	\N
37	6	2026-06-16 13:10:11.261+05:30	2026-06-09 13:10:11.261842+05:30	3f8c71c1fc2f5ce29babf5d75ee234e184c63becc60ef8485f1b1a8146243cf7	\N
38	6	2026-06-16 13:59:59.233+05:30	2026-06-09 13:59:59.233419+05:30	1581403091a529e9e5cbb952c4defa4169af03d1d6222e8906109b7022e83bd3	\N
39	6	2026-06-16 14:00:04.607+05:30	2026-06-09 14:00:04.607991+05:30	ee331b5a6f9bb938d03e78a52f1dadc8e5750c6eb6379daeb1dfc599c5b4485c	\N
40	6	2026-06-16 14:02:40.441+05:30	2026-06-09 14:02:40.442174+05:30	161794423d3e593181dab344b1631a0fe67a897038d471326715d81a79f5cf9b	\N
41	6	2026-06-16 14:36:29.01+05:30	2026-06-09 14:36:29.010926+05:30	91210115028fa68d68e9d06fb9e02ad132b5d48693983648e5bbe804c38c2429	\N
42	6	2026-06-16 16:13:28.573+05:30	2026-06-09 16:13:28.573998+05:30	4007592f4231b4cb4f31433017d5201627e32e895766d9376c2b23722e556bd4	\N
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.role_permissions (id, role_id, module, submodule, permissions, created_at, updated_at) FROM stdin;
521	1	dashboard	dashboard	1023	2026-06-03 09:53:32.688212+05:30	2026-06-03 09:53:32.688212+05:30
522	2	dashboard	dashboard	1023	2026-06-03 09:53:32.689102+05:30	2026-06-03 09:53:32.689102+05:30
523	3	dashboard	dashboard	1	2026-06-03 09:53:32.689514+05:30	2026-06-03 09:53:32.689514+05:30
524	4	dashboard	dashboard	1	2026-06-03 09:53:32.689869+05:30	2026-06-03 09:53:32.689869+05:30
525	1	inventory	all_inventory	1023	2026-06-03 09:53:32.690174+05:30	2026-06-03 09:53:32.690174+05:30
526	2	inventory	all_inventory	1023	2026-06-03 09:53:32.690517+05:30	2026-06-03 09:53:32.690517+05:30
527	3	inventory	all_inventory	103	2026-06-03 09:53:32.6908+05:30	2026-06-03 09:53:32.6908+05:30
528	4	inventory	all_inventory	65	2026-06-03 09:53:32.69102+05:30	2026-06-03 09:53:32.69102+05:30
529	1	inventory	items_master	1023	2026-06-03 09:53:32.691249+05:30	2026-06-03 09:53:32.691249+05:30
530	2	inventory	items_master	1023	2026-06-03 09:53:32.691452+05:30	2026-06-03 09:53:32.691452+05:30
531	3	inventory	items_master	103	2026-06-03 09:53:32.691726+05:30	2026-06-03 09:53:32.691726+05:30
532	4	inventory	items_master	65	2026-06-03 09:53:32.69203+05:30	2026-06-03 09:53:32.69203+05:30
533	1	inventory	opening_entry	1023	2026-06-03 09:53:32.692265+05:30	2026-06-03 09:53:32.692265+05:30
534	2	inventory	opening_entry	1023	2026-06-03 09:53:32.69259+05:30	2026-06-03 09:53:32.69259+05:30
535	3	inventory	opening_entry	103	2026-06-03 09:53:32.692902+05:30	2026-06-03 09:53:32.692902+05:30
536	4	inventory	opening_entry	65	2026-06-03 09:53:32.693236+05:30	2026-06-03 09:53:32.693236+05:30
537	1	inventory	closing_entry	1023	2026-06-03 09:53:32.693538+05:30	2026-06-03 09:53:32.693538+05:30
538	2	inventory	closing_entry	1023	2026-06-03 09:53:32.693801+05:30	2026-06-03 09:53:32.693801+05:30
539	3	inventory	closing_entry	103	2026-06-03 09:53:32.694024+05:30	2026-06-03 09:53:32.694024+05:30
540	4	inventory	closing_entry	65	2026-06-03 09:53:32.694259+05:30	2026-06-03 09:53:32.694259+05:30
541	1	inventory	mix_lots	1023	2026-06-03 09:53:32.694559+05:30	2026-06-03 09:53:32.694559+05:30
542	2	inventory	mix_lots	1023	2026-06-03 09:53:32.694795+05:30	2026-06-03 09:53:32.694795+05:30
543	3	inventory	mix_lots	103	2026-06-03 09:53:32.695029+05:30	2026-06-03 09:53:32.695029+05:30
544	4	inventory	mix_lots	65	2026-06-03 09:53:32.695252+05:30	2026-06-03 09:53:32.695252+05:30
545	1	inventory	stock_transfer	1023	2026-06-03 09:53:32.695481+05:30	2026-06-03 09:53:32.695481+05:30
546	2	inventory	stock_transfer	1023	2026-06-03 09:53:32.695672+05:30	2026-06-03 09:53:32.695672+05:30
547	3	inventory	stock_transfer	103	2026-06-03 09:53:32.695847+05:30	2026-06-03 09:53:32.695847+05:30
548	4	inventory	stock_transfer	65	2026-06-03 09:53:32.696014+05:30	2026-06-03 09:53:32.696014+05:30
549	1	inventory	lot_movements	1023	2026-06-03 09:53:32.696204+05:30	2026-06-03 09:53:32.696204+05:30
550	2	inventory	lot_movements	1023	2026-06-03 09:53:32.696478+05:30	2026-06-03 09:53:32.696478+05:30
551	3	inventory	lot_movements	103	2026-06-03 09:53:32.696688+05:30	2026-06-03 09:53:32.696688+05:30
552	4	inventory	lot_movements	65	2026-06-03 09:53:32.69687+05:30	2026-06-03 09:53:32.69687+05:30
553	1	inventory	process_issues	1023	2026-06-03 09:53:32.697048+05:30	2026-06-03 09:53:32.697048+05:30
554	2	inventory	process_issues	1023	2026-06-03 09:53:32.697215+05:30	2026-06-03 09:53:32.697215+05:30
555	3	inventory	process_issues	103	2026-06-03 09:53:32.697393+05:30	2026-06-03 09:53:32.697393+05:30
556	4	inventory	process_issues	65	2026-06-03 09:53:32.697556+05:30	2026-06-03 09:53:32.697556+05:30
557	1	inventory	start_process	1023	2026-06-03 09:53:32.697746+05:30	2026-06-03 09:53:32.697746+05:30
558	2	inventory	start_process	1023	2026-06-03 09:53:32.698018+05:30	2026-06-03 09:53:32.698018+05:30
559	3	inventory	start_process	103	2026-06-03 09:53:32.698247+05:30	2026-06-03 09:53:32.698247+05:30
560	4	inventory	start_process	65	2026-06-03 09:53:32.698477+05:30	2026-06-03 09:53:32.698477+05:30
561	1	purchase	vendors	1023	2026-06-03 09:53:32.698713+05:30	2026-06-03 09:53:32.698713+05:30
562	2	purchase	vendors	1023	2026-06-03 09:53:32.698905+05:30	2026-06-03 09:53:32.698905+05:30
563	3	purchase	vendors	71	2026-06-03 09:53:32.699071+05:30	2026-06-03 09:53:32.699071+05:30
564	4	purchase	vendors	65	2026-06-03 09:53:32.699236+05:30	2026-06-03 09:53:32.699236+05:30
565	1	purchase	purchase_notes	1023	2026-06-03 09:53:32.699404+05:30	2026-06-03 09:53:32.699404+05:30
566	2	purchase	purchase_notes	1023	2026-06-03 09:53:32.699562+05:30	2026-06-03 09:53:32.699562+05:30
567	3	purchase	purchase_notes	71	2026-06-03 09:53:32.699717+05:30	2026-06-03 09:53:32.699717+05:30
568	4	purchase	purchase_notes	65	2026-06-03 09:53:32.699874+05:30	2026-06-03 09:53:32.699874+05:30
569	1	purchase	new_purchase_note	1023	2026-06-03 09:53:32.700033+05:30	2026-06-03 09:53:32.700033+05:30
570	2	purchase	new_purchase_note	1023	2026-06-03 09:53:32.700191+05:30	2026-06-03 09:53:32.700191+05:30
571	3	purchase	new_purchase_note	71	2026-06-03 09:53:32.700351+05:30	2026-06-03 09:53:32.700351+05:30
572	4	purchase	new_purchase_note	65	2026-06-03 09:53:32.700507+05:30	2026-06-03 09:53:32.700507+05:30
573	1	purchase	expenses	1023	2026-06-03 09:53:32.700682+05:30	2026-06-03 09:53:32.700682+05:30
574	2	purchase	expenses	1023	2026-06-03 09:53:32.70096+05:30	2026-06-03 09:53:32.70096+05:30
575	3	purchase	expenses	71	2026-06-03 09:53:32.701194+05:30	2026-06-03 09:53:32.701194+05:30
576	4	purchase	expenses	65	2026-06-03 09:53:32.701413+05:30	2026-06-03 09:53:32.701413+05:30
577	1	process	process_log	1023	2026-06-03 09:53:32.701738+05:30	2026-06-03 09:53:32.701738+05:30
578	2	process	process_log	1023	2026-06-03 09:53:32.70201+05:30	2026-06-03 09:53:32.70201+05:30
579	3	process	process_log	7	2026-06-03 09:53:32.702241+05:30	2026-06-03 09:53:32.702241+05:30
580	4	process	process_log	1	2026-06-03 09:53:32.702435+05:30	2026-06-03 09:53:32.702435+05:30
581	1	process	send_to_process	1023	2026-06-03 09:53:32.702635+05:30	2026-06-03 09:53:32.702635+05:30
582	2	process	send_to_process	1023	2026-06-03 09:53:32.702916+05:30	2026-06-03 09:53:32.702916+05:30
583	3	process	send_to_process	7	2026-06-03 09:53:32.703177+05:30	2026-06-03 09:53:32.703177+05:30
584	4	process	send_to_process	1	2026-06-03 09:53:32.703456+05:30	2026-06-03 09:53:32.703456+05:30
585	1	process	return_from_process	1023	2026-06-03 09:53:32.703755+05:30	2026-06-03 09:53:32.703755+05:30
586	2	process	return_from_process	1023	2026-06-03 09:53:32.704039+05:30	2026-06-03 09:53:32.704039+05:30
587	3	process	return_from_process	7	2026-06-03 09:53:32.704326+05:30	2026-06-03 09:53:32.704326+05:30
588	4	process	return_from_process	1	2026-06-03 09:53:32.704568+05:30	2026-06-03 09:53:32.704568+05:30
589	1	rough	rough_growth	1023	2026-06-03 09:53:32.704847+05:30	2026-06-03 09:53:32.704847+05:30
590	2	rough	rough_growth	1023	2026-06-03 09:53:32.705125+05:30	2026-06-03 09:53:32.705125+05:30
591	3	rough	rough_growth	7	2026-06-03 09:53:32.705409+05:30	2026-06-03 09:53:32.705409+05:30
592	4	rough	rough_growth	1	2026-06-03 09:53:32.705686+05:30	2026-06-03 09:53:32.705686+05:30
593	1	rough	new_growth_entry	1023	2026-06-03 09:53:32.70596+05:30	2026-06-03 09:53:32.70596+05:30
594	2	rough	new_growth_entry	1023	2026-06-03 09:53:32.706214+05:30	2026-06-03 09:53:32.706214+05:30
595	3	rough	new_growth_entry	7	2026-06-03 09:53:32.706484+05:30	2026-06-03 09:53:32.706484+05:30
596	4	rough	new_growth_entry	1	2026-06-03 09:53:32.706773+05:30	2026-06-03 09:53:32.706773+05:30
597	1	sales	invoice	1023	2026-06-03 09:53:32.70705+05:30	2026-06-03 09:53:32.70705+05:30
598	2	sales	invoice	1023	2026-06-03 09:53:32.707327+05:30	2026-06-03 09:53:32.707327+05:30
599	3	sales	invoice	71	2026-06-03 09:53:32.707579+05:30	2026-06-03 09:53:32.707579+05:30
600	4	sales	invoice	65	2026-06-03 09:53:32.707853+05:30	2026-06-03 09:53:32.707853+05:30
601	1	sales	new_invoice	1023	2026-06-03 09:53:32.708077+05:30	2026-06-03 09:53:32.708077+05:30
602	2	sales	new_invoice	1023	2026-06-03 09:53:32.708265+05:30	2026-06-03 09:53:32.708265+05:30
603	3	sales	new_invoice	71	2026-06-03 09:53:32.708449+05:30	2026-06-03 09:53:32.708449+05:30
604	4	sales	new_invoice	65	2026-06-03 09:53:32.708645+05:30	2026-06-03 09:53:32.708645+05:30
605	1	sales	customers	1023	2026-06-03 09:53:32.708882+05:30	2026-06-03 09:53:32.708882+05:30
606	2	sales	customers	1023	2026-06-03 09:53:32.709098+05:30	2026-06-03 09:53:32.709098+05:30
607	3	sales	customers	71	2026-06-03 09:53:32.709334+05:30	2026-06-03 09:53:32.709334+05:30
608	4	sales	customers	65	2026-06-03 09:53:32.709575+05:30	2026-06-03 09:53:32.709575+05:30
609	1	accounting	chart_of_accounts	1023	2026-06-03 09:53:32.70984+05:30	2026-06-03 09:53:32.70984+05:30
610	2	accounting	chart_of_accounts	1023	2026-06-03 09:53:32.710113+05:30	2026-06-03 09:53:32.710113+05:30
611	3	accounting	chart_of_accounts	7	2026-06-03 09:53:32.71034+05:30	2026-06-03 09:53:32.71034+05:30
612	4	accounting	chart_of_accounts	1	2026-06-03 09:53:32.710585+05:30	2026-06-03 09:53:32.710585+05:30
613	1	accounting	journal_entries	1023	2026-06-03 09:53:32.710806+05:30	2026-06-03 09:53:32.710806+05:30
614	2	accounting	journal_entries	1023	2026-06-03 09:53:32.71106+05:30	2026-06-03 09:53:32.71106+05:30
615	3	accounting	journal_entries	7	2026-06-03 09:53:32.711297+05:30	2026-06-03 09:53:32.711297+05:30
616	4	accounting	journal_entries	1	2026-06-03 09:53:32.711525+05:30	2026-06-03 09:53:32.711525+05:30
617	1	accounting	payments	1023	2026-06-03 09:53:32.711826+05:30	2026-06-03 09:53:32.711826+05:30
618	2	accounting	payments	1023	2026-06-03 09:53:32.712121+05:30	2026-06-03 09:53:32.712121+05:30
619	3	accounting	payments	7	2026-06-03 09:53:32.712503+05:30	2026-06-03 09:53:32.712503+05:30
620	4	accounting	payments	1	2026-06-03 09:53:32.712759+05:30	2026-06-03 09:53:32.712759+05:30
621	1	accounting	receipts	1023	2026-06-03 09:53:32.713011+05:30	2026-06-03 09:53:32.713011+05:30
622	2	accounting	receipts	1023	2026-06-03 09:53:32.713492+05:30	2026-06-03 09:53:32.713492+05:30
623	3	accounting	receipts	7	2026-06-03 09:53:32.713726+05:30	2026-06-03 09:53:32.713726+05:30
624	4	accounting	receipts	1	2026-06-03 09:53:32.713979+05:30	2026-06-03 09:53:32.713979+05:30
625	1	accounting	bank_deposits	1023	2026-06-03 09:53:32.714257+05:30	2026-06-03 09:53:32.714257+05:30
626	2	accounting	bank_deposits	1023	2026-06-03 09:53:32.714544+05:30	2026-06-03 09:53:32.714544+05:30
627	3	accounting	bank_deposits	7	2026-06-03 09:53:32.714792+05:30	2026-06-03 09:53:32.714792+05:30
628	4	accounting	bank_deposits	1	2026-06-03 09:53:32.715025+05:30	2026-06-03 09:53:32.715025+05:30
629	1	accounting	depreciation_runs	1023	2026-06-03 09:53:32.715239+05:30	2026-06-03 09:53:32.715239+05:30
630	2	accounting	depreciation_runs	1023	2026-06-03 09:53:32.715429+05:30	2026-06-03 09:53:32.715429+05:30
631	3	accounting	depreciation_runs	7	2026-06-03 09:53:32.715615+05:30	2026-06-03 09:53:32.715615+05:30
632	4	accounting	depreciation_runs	1	2026-06-03 09:53:32.715866+05:30	2026-06-03 09:53:32.715866+05:30
633	1	accounting	new_depreciation_run	1023	2026-06-03 09:53:32.716108+05:30	2026-06-03 09:53:32.716108+05:30
634	2	accounting	new_depreciation_run	1023	2026-06-03 09:53:32.71631+05:30	2026-06-03 09:53:32.71631+05:30
635	3	accounting	new_depreciation_run	7	2026-06-03 09:53:32.716534+05:30	2026-06-03 09:53:32.716534+05:30
636	4	accounting	new_depreciation_run	1	2026-06-03 09:53:32.716811+05:30	2026-06-03 09:53:32.716811+05:30
637	1	assets	asset_list	1023	2026-06-03 09:53:32.717156+05:30	2026-06-03 09:53:32.717156+05:30
638	2	assets	asset_list	1023	2026-06-03 09:53:32.717407+05:30	2026-06-03 09:53:32.717407+05:30
639	3	assets	asset_list	65	2026-06-03 09:53:32.717621+05:30	2026-06-03 09:53:32.717621+05:30
640	4	assets	asset_list	1	2026-06-03 09:53:32.717828+05:30	2026-06-03 09:53:32.717828+05:30
641	1	assets	manual_entry	1023	2026-06-03 09:53:32.718073+05:30	2026-06-03 09:53:32.718073+05:30
642	2	assets	manual_entry	1023	2026-06-03 09:53:32.718334+05:30	2026-06-03 09:53:32.718334+05:30
643	3	assets	manual_entry	65	2026-06-03 09:53:32.718597+05:30	2026-06-03 09:53:32.718597+05:30
644	4	assets	manual_entry	1	2026-06-03 09:53:32.718829+05:30	2026-06-03 09:53:32.718829+05:30
645	1	reports	ledger	1023	2026-06-03 09:53:32.719068+05:30	2026-06-03 09:53:32.719068+05:30
646	2	reports	ledger	1023	2026-06-03 09:53:32.719333+05:30	2026-06-03 09:53:32.719333+05:30
647	3	reports	ledger	97	2026-06-03 09:53:32.719528+05:30	2026-06-03 09:53:32.719528+05:30
648	4	reports	ledger	65	2026-06-03 09:53:32.719733+05:30	2026-06-03 09:53:32.719733+05:30
649	1	reports	trial_balance	1023	2026-06-03 09:53:32.719913+05:30	2026-06-03 09:53:32.719913+05:30
650	2	reports	trial_balance	1023	2026-06-03 09:53:32.72011+05:30	2026-06-03 09:53:32.72011+05:30
651	3	reports	trial_balance	97	2026-06-03 09:53:32.720305+05:30	2026-06-03 09:53:32.720305+05:30
652	4	reports	trial_balance	65	2026-06-03 09:53:32.720473+05:30	2026-06-03 09:53:32.720473+05:30
653	1	reports	profit_loss	1023	2026-06-03 09:53:32.720632+05:30	2026-06-03 09:53:32.720632+05:30
654	2	reports	profit_loss	1023	2026-06-03 09:53:32.720787+05:30	2026-06-03 09:53:32.720787+05:30
655	3	reports	profit_loss	97	2026-06-03 09:53:32.720942+05:30	2026-06-03 09:53:32.720942+05:30
656	4	reports	profit_loss	65	2026-06-03 09:53:32.721113+05:30	2026-06-03 09:53:32.721113+05:30
657	1	reports	costing_report	1023	2026-06-03 09:53:32.721267+05:30	2026-06-03 09:53:32.721267+05:30
658	2	reports	costing_report	1023	2026-06-03 09:53:32.721422+05:30	2026-06-03 09:53:32.721422+05:30
659	3	reports	costing_report	97	2026-06-03 09:53:32.721579+05:30	2026-06-03 09:53:32.721579+05:30
660	4	reports	costing_report	65	2026-06-03 09:53:32.721732+05:30	2026-06-03 09:53:32.721732+05:30
661	1	reports	balance_sheet	1023	2026-06-03 09:53:32.721882+05:30	2026-06-03 09:53:32.721882+05:30
662	2	reports	balance_sheet	1023	2026-06-03 09:53:32.722033+05:30	2026-06-03 09:53:32.722033+05:30
663	3	reports	balance_sheet	97	2026-06-03 09:53:32.722187+05:30	2026-06-03 09:53:32.722187+05:30
664	4	reports	balance_sheet	65	2026-06-03 09:53:32.722338+05:30	2026-06-03 09:53:32.722338+05:30
665	1	reports	fixed_asset_register	1023	2026-06-03 09:53:32.722488+05:30	2026-06-03 09:53:32.722488+05:30
666	2	reports	fixed_asset_register	1023	2026-06-03 09:53:32.722653+05:30	2026-06-03 09:53:32.722653+05:30
667	3	reports	fixed_asset_register	97	2026-06-03 09:53:32.722811+05:30	2026-06-03 09:53:32.722811+05:30
668	4	reports	fixed_asset_register	65	2026-06-03 09:53:32.722961+05:30	2026-06-03 09:53:32.722961+05:30
669	1	reports	depreciation_schedule	1023	2026-06-03 09:53:32.723112+05:30	2026-06-03 09:53:32.723112+05:30
670	2	reports	depreciation_schedule	1023	2026-06-03 09:53:32.72326+05:30	2026-06-03 09:53:32.72326+05:30
671	3	reports	depreciation_schedule	97	2026-06-03 09:53:32.723406+05:30	2026-06-03 09:53:32.723406+05:30
672	4	reports	depreciation_schedule	65	2026-06-03 09:53:32.723554+05:30	2026-06-03 09:53:32.723554+05:30
673	1	reports	accounts_receivable	1023	2026-06-03 09:53:32.723704+05:30	2026-06-03 09:53:32.723704+05:30
674	2	reports	accounts_receivable	1023	2026-06-03 09:53:32.723849+05:30	2026-06-03 09:53:32.723849+05:30
675	3	reports	accounts_receivable	97	2026-06-03 09:53:32.723998+05:30	2026-06-03 09:53:32.723998+05:30
676	4	reports	accounts_receivable	65	2026-06-03 09:53:32.724146+05:30	2026-06-03 09:53:32.724146+05:30
677	1	reports	accounts_payable	1023	2026-06-03 09:53:32.724291+05:30	2026-06-03 09:53:32.724291+05:30
678	2	reports	accounts_payable	1023	2026-06-03 09:53:32.724439+05:30	2026-06-03 09:53:32.724439+05:30
679	3	reports	accounts_payable	97	2026-06-03 09:53:32.724604+05:30	2026-06-03 09:53:32.724604+05:30
680	4	reports	accounts_payable	65	2026-06-03 09:53:32.724842+05:30	2026-06-03 09:53:32.724842+05:30
681	1	reports	bank_reconciliation	1023	2026-06-03 09:53:32.725063+05:30	2026-06-03 09:53:32.725063+05:30
682	2	reports	bank_reconciliation	1023	2026-06-03 09:53:32.725251+05:30	2026-06-03 09:53:32.725251+05:30
683	3	reports	bank_reconciliation	97	2026-06-03 09:53:32.725461+05:30	2026-06-03 09:53:32.725461+05:30
684	4	reports	bank_reconciliation	65	2026-06-03 09:53:32.725754+05:30	2026-06-03 09:53:32.725754+05:30
685	1	reports	cost_center_pl	1023	2026-06-03 09:53:32.726013+05:30	2026-06-03 09:53:32.726013+05:30
686	2	reports	cost_center_pl	1023	2026-06-03 09:53:32.726227+05:30	2026-06-03 09:53:32.726227+05:30
687	3	reports	cost_center_pl	97	2026-06-03 09:53:32.726432+05:30	2026-06-03 09:53:32.726432+05:30
688	4	reports	cost_center_pl	65	2026-06-03 09:53:32.726681+05:30	2026-06-03 09:53:32.726681+05:30
689	1	manufacturing	control_tower	1023	2026-06-03 09:53:32.72689+05:30	2026-06-03 09:53:32.72689+05:30
690	2	manufacturing	control_tower	1023	2026-06-03 09:53:32.727077+05:30	2026-06-03 09:53:32.727077+05:30
691	3	manufacturing	control_tower	7	2026-06-03 09:53:32.727246+05:30	2026-06-03 09:53:32.727246+05:30
692	4	manufacturing	control_tower	1	2026-06-03 09:53:32.727408+05:30	2026-06-03 09:53:32.727408+05:30
693	1	manufacturing	process_master	1023	2026-06-03 09:53:32.727565+05:30	2026-06-03 09:53:32.727565+05:30
694	2	manufacturing	process_master	1023	2026-06-03 09:53:32.72772+05:30	2026-06-03 09:53:32.72772+05:30
695	3	manufacturing	process_master	7	2026-06-03 09:53:32.727877+05:30	2026-06-03 09:53:32.727877+05:30
696	4	manufacturing	process_master	1	2026-06-03 09:53:32.728039+05:30	2026-06-03 09:53:32.728039+05:30
697	1	manufacturing	machines	1023	2026-06-03 09:53:32.728204+05:30	2026-06-03 09:53:32.728204+05:30
698	2	manufacturing	machines	1023	2026-06-03 09:53:32.72836+05:30	2026-06-03 09:53:32.72836+05:30
699	3	manufacturing	machines	7	2026-06-03 09:53:32.728513+05:30	2026-06-03 09:53:32.728513+05:30
700	4	manufacturing	machines	1	2026-06-03 09:53:32.728662+05:30	2026-06-03 09:53:32.728662+05:30
701	1	manufacturing	departments	1023	2026-06-03 09:53:32.728815+05:30	2026-06-03 09:53:32.728815+05:30
702	2	manufacturing	departments	1023	2026-06-03 09:53:32.728965+05:30	2026-06-03 09:53:32.728965+05:30
703	3	manufacturing	departments	7	2026-06-03 09:53:32.729115+05:30	2026-06-03 09:53:32.729115+05:30
704	4	manufacturing	departments	1	2026-06-03 09:53:32.729264+05:30	2026-06-03 09:53:32.729264+05:30
705	1	manufacturing	locations	1023	2026-06-03 09:53:32.72942+05:30	2026-06-03 09:53:32.72942+05:30
706	2	manufacturing	locations	1023	2026-06-03 09:53:32.729571+05:30	2026-06-03 09:53:32.729571+05:30
707	3	manufacturing	locations	7	2026-06-03 09:53:32.729719+05:30	2026-06-03 09:53:32.729719+05:30
708	4	manufacturing	locations	1	2026-06-03 09:53:32.729869+05:30	2026-06-03 09:53:32.729869+05:30
709	1	manufacturing	uom	1023	2026-06-03 09:53:32.730017+05:30	2026-06-03 09:53:32.730017+05:30
710	2	manufacturing	uom	1023	2026-06-03 09:53:32.730165+05:30	2026-06-03 09:53:32.730165+05:30
711	3	manufacturing	uom	7	2026-06-03 09:53:32.730324+05:30	2026-06-03 09:53:32.730324+05:30
712	4	manufacturing	uom	1	2026-06-03 09:53:32.730484+05:30	2026-06-03 09:53:32.730484+05:30
713	1	manufacturing	expense_categories	1023	2026-06-03 09:53:32.730635+05:30	2026-06-03 09:53:32.730635+05:30
714	2	manufacturing	expense_categories	1023	2026-06-03 09:53:32.731678+05:30	2026-06-03 09:53:32.731678+05:30
715	3	manufacturing	expense_categories	7	2026-06-03 09:53:32.731928+05:30	2026-06-03 09:53:32.731928+05:30
716	4	manufacturing	expense_categories	1	2026-06-03 09:53:32.732183+05:30	2026-06-03 09:53:32.732183+05:30
717	1	manufacturing	asset_categories	1023	2026-06-03 09:53:32.732437+05:30	2026-06-03 09:53:32.732437+05:30
718	2	manufacturing	asset_categories	1023	2026-06-03 09:53:32.732725+05:30	2026-06-03 09:53:32.732725+05:30
719	3	manufacturing	asset_categories	7	2026-06-03 09:53:32.733041+05:30	2026-06-03 09:53:32.733041+05:30
720	4	manufacturing	asset_categories	1	2026-06-03 09:53:32.73329+05:30	2026-06-03 09:53:32.73329+05:30
721	1	admin	users	1023	2026-06-03 09:53:32.73354+05:30	2026-06-03 09:53:32.73354+05:30
722	2	admin	users	1023	2026-06-03 09:53:32.733746+05:30	2026-06-03 09:53:32.733746+05:30
723	3	admin	users	0	2026-06-03 09:53:32.733924+05:30	2026-06-03 09:53:32.733924+05:30
724	4	admin	users	0	2026-06-03 09:53:32.734104+05:30	2026-06-03 09:53:32.734104+05:30
725	1	admin	roles	1023	2026-06-03 09:53:32.734263+05:30	2026-06-03 09:53:32.734263+05:30
726	2	admin	roles	1023	2026-06-03 09:53:32.73442+05:30	2026-06-03 09:53:32.73442+05:30
727	3	admin	roles	0	2026-06-03 09:53:32.734575+05:30	2026-06-03 09:53:32.734575+05:30
728	4	admin	roles	0	2026-06-03 09:53:32.734723+05:30	2026-06-03 09:53:32.734723+05:30
729	1	admin	audit_logs	1023	2026-06-03 09:53:32.73487+05:30	2026-06-03 09:53:32.73487+05:30
730	2	admin	audit_logs	1023	2026-06-03 09:53:32.735014+05:30	2026-06-03 09:53:32.735014+05:30
731	3	admin	audit_logs	0	2026-06-03 09:53:32.735163+05:30	2026-06-03 09:53:32.735163+05:30
732	4	admin	audit_logs	0	2026-06-03 09:53:32.735306+05:30	2026-06-03 09:53:32.735306+05:30
733	1	admin	settings	1023	2026-06-03 09:53:32.735451+05:30	2026-06-03 09:53:32.735451+05:30
734	2	admin	settings	1023	2026-06-03 09:53:32.735595+05:30	2026-06-03 09:53:32.735595+05:30
735	3	admin	settings	0	2026-06-03 09:53:32.735877+05:30	2026-06-03 09:53:32.735877+05:30
736	4	admin	settings	0	2026-06-03 09:53:32.736061+05:30	2026-06-03 09:53:32.736061+05:30
737	1	hr	employees	1023	2026-06-03 09:53:32.736233+05:30	2026-06-03 09:53:32.736233+05:30
738	2	hr	employees	1023	2026-06-03 09:53:32.736392+05:30	2026-06-03 09:53:32.736392+05:30
739	3	hr	employees	0	2026-06-03 09:53:32.736545+05:30	2026-06-03 09:53:32.736545+05:30
740	4	hr	employees	0	2026-06-03 09:53:32.736705+05:30	2026-06-03 09:53:32.736705+05:30
741	1	hr	attendance	1023	2026-06-03 09:53:32.736907+05:30	2026-06-03 09:53:32.736907+05:30
742	2	hr	attendance	1023	2026-06-03 09:53:32.737102+05:30	2026-06-03 09:53:32.737102+05:30
743	3	hr	attendance	0	2026-06-03 09:53:32.73729+05:30	2026-06-03 09:53:32.73729+05:30
744	4	hr	attendance	0	2026-06-03 09:53:32.737451+05:30	2026-06-03 09:53:32.737451+05:30
745	1	finance	budgets	1023	2026-06-03 09:53:32.737605+05:30	2026-06-03 09:53:32.737605+05:30
746	2	finance	budgets	1023	2026-06-03 09:53:32.737753+05:30	2026-06-03 09:53:32.737753+05:30
747	3	finance	budgets	0	2026-06-03 09:53:32.7379+05:30	2026-06-03 09:53:32.7379+05:30
748	4	finance	budgets	0	2026-06-03 09:53:32.738059+05:30	2026-06-03 09:53:32.738059+05:30
749	1	finance	cashflow	1023	2026-06-03 09:53:32.738216+05:30	2026-06-03 09:53:32.738216+05:30
750	2	finance	cashflow	1023	2026-06-03 09:53:32.738364+05:30	2026-06-03 09:53:32.738364+05:30
751	3	finance	cashflow	0	2026-06-03 09:53:32.738509+05:30	2026-06-03 09:53:32.738509+05:30
752	4	finance	cashflow	0	2026-06-03 09:53:32.738662+05:30	2026-06-03 09:53:32.738662+05:30
753	1	master_data	departments	1023	2026-06-03 09:53:32.738806+05:30	2026-06-03 09:53:32.738806+05:30
754	2	master_data	departments	1023	2026-06-03 09:53:32.738948+05:30	2026-06-03 09:53:32.738948+05:30
755	3	master_data	departments	7	2026-06-03 09:53:32.739095+05:30	2026-06-03 09:53:32.739095+05:30
756	4	master_data	departments	1	2026-06-03 09:53:32.739245+05:30	2026-06-03 09:53:32.739245+05:30
757	1	master_data	locations	1023	2026-06-03 09:53:32.739392+05:30	2026-06-03 09:53:32.739392+05:30
758	2	master_data	locations	1023	2026-06-03 09:53:32.739536+05:30	2026-06-03 09:53:32.739536+05:30
759	3	master_data	locations	7	2026-06-03 09:53:32.739677+05:30	2026-06-03 09:53:32.739677+05:30
760	4	master_data	locations	1	2026-06-03 09:53:32.739817+05:30	2026-06-03 09:53:32.739817+05:30
761	1	master_data	machines	1023	2026-06-03 09:53:32.739961+05:30	2026-06-03 09:53:32.739961+05:30
762	2	master_data	machines	1023	2026-06-03 09:53:32.740105+05:30	2026-06-03 09:53:32.740105+05:30
763	3	master_data	machines	7	2026-06-03 09:53:32.740311+05:30	2026-06-03 09:53:32.740311+05:30
764	4	master_data	machines	1	2026-06-03 09:53:32.740511+05:30	2026-06-03 09:53:32.740511+05:30
765	1	master_data	uom	1023	2026-06-03 09:53:32.740718+05:30	2026-06-03 09:53:32.740718+05:30
766	2	master_data	uom	1023	2026-06-03 09:53:32.740916+05:30	2026-06-03 09:53:32.740916+05:30
767	3	master_data	uom	7	2026-06-03 09:53:32.74111+05:30	2026-06-03 09:53:32.74111+05:30
768	4	master_data	uom	1	2026-06-03 09:53:32.741281+05:30	2026-06-03 09:53:32.741281+05:30
769	1	master_data	expense_categories	1023	2026-06-03 09:53:32.741441+05:30	2026-06-03 09:53:32.741441+05:30
770	2	master_data	expense_categories	1023	2026-06-03 09:53:32.741651+05:30	2026-06-03 09:53:32.741651+05:30
771	3	master_data	expense_categories	7	2026-06-03 09:53:32.741841+05:30	2026-06-03 09:53:32.741841+05:30
772	4	master_data	expense_categories	1	2026-06-03 09:53:32.742034+05:30	2026-06-03 09:53:32.742034+05:30
773	1	master_data	asset_categories	1023	2026-06-03 09:53:32.742208+05:30	2026-06-03 09:53:32.742208+05:30
774	2	master_data	asset_categories	1023	2026-06-03 09:53:32.742372+05:30	2026-06-03 09:53:32.742372+05:30
775	3	master_data	asset_categories	7	2026-06-03 09:53:32.742562+05:30	2026-06-03 09:53:32.742562+05:30
776	4	master_data	asset_categories	1	2026-06-03 09:53:32.74278+05:30	2026-06-03 09:53:32.74278+05:30
777	1	clipboard	clipboard	1023	2026-06-03 09:53:32.743012+05:30	2026-06-03 09:53:32.743012+05:30
778	2	clipboard	clipboard	1023	2026-06-03 09:53:32.743288+05:30	2026-06-03 09:53:32.743288+05:30
779	3	clipboard	clipboard	1	2026-06-03 09:53:32.743521+05:30	2026-06-03 09:53:32.743521+05:30
780	4	clipboard	clipboard	1	2026-06-03 09:53:32.743732+05:30	2026-06-03 09:53:32.743732+05:30
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.roles (id, name, slug, description, is_system, is_active, created_at, updated_at) FROM stdin;
1	Super Admin	super_admin	Unrestricted full system access — bypasses all permission checks	t	t	2026-06-02 18:37:38.426356+05:30	2026-06-02 18:37:38.426356+05:30
2	Admin	admin	Full system access	t	t	2026-06-02 18:37:38.429082+05:30	2026-06-02 18:37:38.429082+05:30
3	Operator	operator	Day-to-day operations	t	t	2026-06-02 18:37:38.429431+05:30	2026-06-02 18:37:38.429431+05:30
4	Viewer	viewer	Read-only access	t	t	2026-06-02 18:37:38.429762+05:30	2026-06-02 18:37:38.429762+05:30
\.


--
-- Data for Name: rough_growth; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.rough_growth (id, growth_number, growth_date, cycle_no, machine_id, seed_inventory_id, department_id, remark, total_lots, total_weight, cost_seed, cost_gas, cost_power, cost_labour, cost_consumable, cost_maintenance, total_cost, cost_per_carat, je_id, status, created_by, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: rough_growth_lines; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.rough_growth_lines (id, growth_id, line_no, lot_number, weight, size_ref, shape, color_est, clarity_est, remark, inventory_id, created_at) FROM stdin;
\.


--
-- Data for Name: session_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.session_log (id, user_id, login_at, logout_at, ip_address, user_agent) FROM stdin;
\.


--
-- Data for Name: stock_transfer; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.stock_transfer (id, transfer_number, status, source_location_id, destination_location_id, notes, created_at, created_by) FROM stdin;
\.


--
-- Data for Name: stock_transfer_items; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.stock_transfer_items (id, stock_transfer_id, lot_id, transfer_qty) FROM stdin;
\.


--
-- Data for Name: sys_event_outbox; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sys_event_outbox (id, topic, payload, created_at) FROM stdin;
a36f2dfd-bd36-4d6d-8681-71187f6f4744	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:54.444383+05:30
a948ba6a-3125-41f9-86f3-83d68b65b8f2	user.login	{"id": 8, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "admin", "_replayed": true}	2026-06-09 14:33:54.446687+05:30
392b7318-0d17-47bb-9acc-6aa9c2dac0c5	vendor.created	{"id": 72, "pan": null, "city": "Surat", "code": "VND-0062", "name": "xc", "email": "nidhiimpex.rohitdata@gmail.com", "gstin": null, "phone": "+918305487046", "state": "Gujarat", "status": "active", "_routed": ["room:purchase", "room:dashboard"], "address": "varachha", "category": "general", "_replayed": true, "account_id": null, "created_at": "2026-06-08T12:39:28.270Z", "updated_at": "2026-06-08T12:39:28.270Z", "bank_details": null, "payment_term": "Immediate", "contact_person": "Rohit"}	2026-06-09 14:33:54.450368+05:30
4af7f398-a054-462b-8001-804c74ec169c	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:24.436061+05:30
cabb7626-f465-46f9-bf40-b33151db46be	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:24.439364+05:30
39e7c006-c324-456f-b2a7-0e746ed07773	vendor.created	{"id": 70, "pan": null, "city": "Surat", "code": "VND-0060", "name": "Rohit", "email": "nidhiimpex.rohitdata@gmail.com", "gstin": null, "phone": "+918305487046", "state": "Gujarat", "status": "active", "_routed": ["room:purchase", "room:dashboard"], "address": "varachha", "category": "general", "_replayed": true, "account_id": null, "created_at": "2026-06-08T12:29:28.037Z", "updated_at": "2026-06-08T12:29:28.037Z", "bank_details": null, "payment_term": "Immediate", "contact_person": "Rohit"}	2026-06-09 14:33:24.443877+05:30
6c5b66b6-71eb-43bd-9287-77dd2b87f607	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:24.445307+05:30
11410ec0-01af-4971-8337-bef9eaf092cc	user.login	{"id": 8, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "admin", "_replayed": true}	2026-06-09 14:33:24.447925+05:30
64e9c7aa-417c-4b60-aed5-1277ca27eebd	inventory.closing	{"id": 2, "date": "2026-06-09", "rate": 500, "_routed": ["room:inventory", "room:dashboard"], "item_id": 23, "quantity": 50, "_replayed": true, "created_by": 6}	2026-06-09 14:33:24.450932+05:30
f8b76870-453e-4cf0-aea0-da3ba51c5c24	vendor.created	{"id": 73, "pan": null, "city": "Surat", "code": "VND-0063", "name": "e", "email": null, "gstin": null, "phone": null, "state": "Gujarat", "status": "active", "_routed": ["room:purchase", "room:dashboard"], "address": "e", "category": "general", "_replayed": true, "account_id": null, "created_at": "2026-06-08T12:39:47.910Z", "updated_at": "2026-06-08T12:39:47.910Z", "bank_details": null, "payment_term": "Immediate", "contact_person": "e"}	2026-06-09 14:33:24.455751+05:30
c91fba8f-570b-4c1c-97af-32f056f376cd	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:24.458325+05:30
e3996bff-9f0f-4eca-9465-f235e9026e5b	vendor.created	{"id": 67, "pan": null, "city": "Surat", "code": "V0015", "name": "Rohit", "email": "nidhiimpex.rohitdata@gmail.com", "gstin": null, "phone": "+918305487046", "state": "Gujarat", "status": "active", "_routed": ["room:purchase", "room:dashboard"], "address": "varachha", "category": "general", "_replayed": true, "account_id": null, "created_at": "2026-06-08T12:15:19.405Z", "updated_at": "2026-06-08T12:15:19.405Z", "bank_details": null, "payment_term": "Immediate", "contact_person": "Rohit"}	2026-06-09 14:33:24.460834+05:30
83e77c52-1210-490c-9911-b637f86fbb41	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:54.445947+05:30
f1c80443-9e64-49d7-a4f9-0b811afb8ffe	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:54.450996+05:30
91752bc9-6127-4f98-af80-b95452a05518	purchase.created	{"id": 23, "_routed": ["room:purchase", "room:inventory", "room:dashboard"], "_replayed": true, "item_type": "seed", "vendor_id": 7, "created_by": 6, "doc_number": "PN-2070", "grand_total": 706602.4}	2026-06-09 14:33:24.434009+05:30
e580f6b1-908d-4d35-8a7d-68054c028831	manufacturing.machine.status_changed	{"id": 122, "module": "manufacturing", "_routed": ["room:manufacturing", "room:dashboard"], "_replayed": true, "new_status": "idle", "old_status": "breakdown"}	2026-06-09 14:33:24.436993+05:30
336977de-a54f-4210-85e9-8769d152b68e	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:24.438699+05:30
9af52fd1-c424-4ecd-b1aa-eaa57a392fe8	user.login	{"id": 8, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "admin", "_replayed": true}	2026-06-09 14:33:24.440666+05:30
19704746-1822-4533-9eac-f9d69de6daff	vendor.created	{"id": 74, "pan": null, "city": "Surat", "code": "VND-0064", "name": "df", "email": "nidhiimpex.rohitdata@gmail.com", "gstin": null, "phone": "+918305487046", "state": "Gujarat", "status": "active", "_routed": ["room:purchase", "room:dashboard"], "address": "varachha", "category": "general", "_replayed": true, "account_id": null, "created_at": "2026-06-08T13:03:47.059Z", "updated_at": "2026-06-08T13:03:47.059Z", "bank_details": null, "payment_term": "Immediate", "contact_person": "Rohit"}	2026-06-09 14:33:24.442439+05:30
23696ce6-b814-40e1-aac7-b7b80882789d	master.created	{"id": 23, "module": "masters", "_routed": ["room:dashboard"], "_replayed": true, "tableName": "items"}	2026-06-09 14:33:24.446481+05:30
c8956964-0c8b-4e4a-a1ab-d85f1cfe50b7	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:24.4498+05:30
1ad2163b-d627-4bd3-9680-950b7a2e1865	user.login	{"id": 8, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "admin", "_replayed": true}	2026-06-09 14:33:24.451546+05:30
d626879e-d532-4e3b-8f36-7d5dfdf5de8c	vendor.created	{"id": 71, "pan": null, "city": "Surat", "code": "VND-0061", "name": "qq", "email": null, "gstin": null, "phone": null, "state": "Gujarat", "status": "active", "_routed": ["room:purchase", "room:dashboard"], "address": "q", "category": "general", "_replayed": true, "account_id": null, "created_at": "2026-06-08T12:29:53.475Z", "updated_at": "2026-06-08T12:29:53.475Z", "bank_details": null, "payment_term": "Immediate", "contact_person": "qq"}	2026-06-09 14:33:24.452749+05:30
0897db43-d940-4bda-9697-1d806050a42e	manufacturing.process.held	{"id": 87, "module": "manufacturing", "_routed": ["room:manufacturing", "room:dashboard"], "_replayed": true, "machine_id": 122, "process_number": "PR-000106"}	2026-06-09 14:33:24.453994+05:30
b0db9631-97ae-4120-90e6-57ea7e5e2384	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:24.455204+05:30
f277f33a-becb-4f4c-bcb8-2cd401838291	manufacturing.machine.status_changed	{"id": 122, "module": "manufacturing", "_routed": ["room:manufacturing", "room:dashboard"], "_replayed": true, "new_status": "breakdown", "old_status": "maintenance"}	2026-06-09 14:33:24.456878+05:30
8914aca6-9680-4630-9ccf-7ed895c23de3	inventory.created	{"source": "purchase", "_routed": ["room:inventory", "room:dashboard"], "_replayed": true, "doc_number": "PN-2069", "lines_count": 1}	2026-06-09 14:33:24.460138+05:30
315233b9-4206-4e93-aad2-ace1110b6c7f	purchase.created	{"id": 22, "_routed": ["room:purchase", "room:inventory", "room:dashboard"], "_replayed": true, "item_type": "seed", "vendor_id": 7, "created_by": 6, "doc_number": "PN-2069", "grand_total": 2344.65}	2026-06-09 14:33:24.46148+05:30
651369bc-1c2b-4836-b243-032ca540e351	vendor.created	{"id": 66, "pan": null, "city": null, "code": "TEST001", "name": "Test Vendor", "email": "test@test.com", "gstin": "29AAAAA0000A1Z5", "phone": "1234567890", "state": null, "status": "active", "_routed": ["room:purchase", "room:dashboard"], "address": "Test Address", "category": "general", "_replayed": true, "account_id": null, "created_at": "2026-06-08T12:06:55.203Z", "updated_at": "2026-06-08T12:06:55.203Z", "bank_details": null, "payment_term": "Immediate", "contact_person": null}	2026-06-09 14:33:24.462817+05:30
87ab065d-8849-4506-afd9-547f7fb5de46	vendor.created	{"id": 75, "pan": null, "city": "Surat", "code": "VND-0065", "name": "xc", "email": "nidhiimpex.rohitdata@gmail.com", "gstin": null, "phone": "+918305487046", "state": "Gujarat", "status": "active", "_routed": ["room:purchase", "room:dashboard"], "address": "varachha", "category": "general", "_replayed": true, "account_id": null, "created_at": "2026-06-09T04:59:11.510Z", "updated_at": "2026-06-09T04:59:11.510Z", "bank_details": null, "payment_term": "Immediate", "contact_person": "Rohit"}	2026-06-09 14:33:54.449641+05:30
9f57128d-ab5d-42ef-ac3a-794105e384b5	user.login	{"id": 8, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "admin", "_replayed": true}	2026-06-09 14:33:24.432382+05:30
5be06ccd-e977-430e-b8c5-ccfa16f9fb11	inventory.opening	{"id": 3, "rate": 1000, "value": 100000, "_routed": ["room:inventory", "room:dashboard"], "item_id": 23, "quantity": 100, "_replayed": true, "as_of_date": "2026-06-09", "created_by": 6}	2026-06-09 14:33:24.437953+05:30
805e4dd7-3a4a-4f2d-90cf-fd824c280d19	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:24.440006+05:30
3ae164a1-0f9c-44f4-bab1-27a6dce73b60	user.login	{"id": 8, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "admin", "_replayed": true}	2026-06-09 14:33:24.44141+05:30
a3fa5023-501e-496d-a3a9-ab2f2d8707f1	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:24.442984+05:30
a73124e1-0eea-492b-8d12-dcc16b1a362c	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:24.444558+05:30
16ed1fd1-7f16-490e-9b68-befe78eda3fd	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:24.445807+05:30
7112300b-6c3c-4334-ab68-65e4053de103	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:24.447322+05:30
76e36bf8-64c8-4b0d-ae65-0a2aca0b54e0	process_master.created	{"id": 10, "module": "manufacturing", "_routed": ["room:manufacturing", "room:dashboard"], "_replayed": true, "process_code": "p-001", "process_name": "Growth"}	2026-06-09 14:33:24.448473+05:30
8338d8c1-cc67-4621-b971-85c1ffc3de22	manufacturing.process.started	{"id": 87, "module": "manufacturing", "_routed": ["room:manufacturing", "room:process", "room:dashboard"], "_replayed": true, "machine_id": 122, "process_type": "p-001", "process_number": "PR-000106"}	2026-06-09 14:33:24.452116+05:30
8b5560eb-7b4e-4e02-9a8d-b4e957e9f6f2	lot.merged	{"_routed": ["room:inventory", "room:manufacturing"], "_replayed": true, "movement_id": 17, "child_lot_id": 230, "parent_lot_ids": [228, 229], "movement_number": "LM-202606-1014", "child_lot_number": "MX0006"}	2026-06-09 14:33:24.453355+05:30
eeab60d2-5b3f-41ed-9cac-d6dab13d0751	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:24.454612+05:30
eaad7e1b-ba1e-4639-aee3-7f64eb1ea41d	manufacturing.machine.status_changed	{"id": 122, "module": "manufacturing", "_routed": ["room:manufacturing", "room:dashboard"], "_replayed": true, "new_status": "maintenance", "old_status": "hold"}	2026-06-09 14:33:24.456287+05:30
86509852-e675-4500-9023-54bb598f7edf	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:24.457433+05:30
0e59c73c-f2f2-4724-91c1-e56ba2ed08b5	inventory.created	{"source": "purchase", "_routed": ["room:inventory", "room:dashboard"], "_replayed": true, "doc_number": "PN-2070", "lines_count": 1}	2026-06-09 14:33:24.459153+05:30
441c34a6-e0c6-48e0-9101-8636505882bf	user.login	{"id": 6, "role": "super_admin", "module": "auth", "_routed": ["room:admin"], "username": "Superadmin", "_replayed": true}	2026-06-09 14:33:24.462143+05:30
\.


--
-- Data for Name: uom; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.uom (id, code, name, symbol, type, status) FROM stdin;
\.


--
-- Data for Name: user_clipboard; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_clipboard (id, user_id, entity_type, entity_id, label, added_at) FROM stdin;
280	6	inventory	226	1019-02A-R1	2026-06-07 12:54:06.063049+05:30
\.


--
-- Data for Name: user_dashboard_widgets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_dashboard_widgets (id, user_id, widget_key, "position", is_visible, created_at) FROM stdin;
\.


--
-- Data for Name: user_permissions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_permissions (id, user_id, module, permission_key, allowed, created_at) FROM stdin;
\.


--
-- Data for Name: user_preferences; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_preferences (id, user_id, pref_key, pref_value) FROM stdin;
133	3	landing_page	/
134	3	rows_per_page	50
135	3	theme	light
136	3	compact_mode	false
137	3	default_branch	
138	3	vis.show_cogs	true
139	3	vis.show_purchase_rate	true
140	3	vis.show_sale_rate	true
141	3	vis.show_margin	true
142	3	vis.show_gross_profit	true
143	3	vis.show_net_profit	true
144	3	vis.show_balances	true
145	4	landing_page	/
146	4	rows_per_page	50
147	4	theme	light
148	4	compact_mode	false
149	4	default_branch	
150	4	vis.show_cogs	true
151	4	vis.show_purchase_rate	true
152	4	vis.show_sale_rate	true
153	4	vis.show_margin	true
154	4	vis.show_gross_profit	true
155	4	vis.show_net_profit	true
156	4	vis.show_balances	true
85	1	landing_page	/
86	1	rows_per_page	50
87	1	theme	light
88	1	compact_mode	false
89	1	default_branch	
90	1	vis.show_cogs	true
91	1	vis.show_purchase_rate	true
92	1	vis.show_sale_rate	true
93	1	vis.show_margin	true
94	1	vis.show_gross_profit	true
95	1	vis.show_net_profit	true
96	1	vis.show_balances	true
157	5	landing_page	/
158	5	rows_per_page	50
159	5	theme	light
160	5	compact_mode	false
161	5	default_branch	
162	5	vis.show_cogs	true
163	5	vis.show_purchase_rate	true
164	5	vis.show_sale_rate	true
165	5	vis.show_margin	true
166	5	vis.show_gross_profit	true
167	5	vis.show_net_profit	true
168	5	vis.show_balances	true
169	6	landing_page	/
170	6	rows_per_page	50
171	6	theme	light
172	6	compact_mode	false
173	6	default_branch	
174	6	vis.show_cogs	true
175	6	vis.show_purchase_rate	true
176	6	vis.show_sale_rate	true
177	6	vis.show_margin	true
178	6	vis.show_gross_profit	true
179	6	vis.show_net_profit	true
180	6	vis.show_balances	true
\.


--
-- Data for Name: user_roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_roles (id, user_id, role_id, assigned_by, assigned_at) FROM stdin;
10	1	2	6	2026-06-05 10:42:26.118387+05:30
14	3	3	6	2026-06-05 14:08:31.428627+05:30
15	4	4	6	2026-06-05 14:08:41.248434+05:30
16	5	2	6	2026-06-05 14:08:52.554574+05:30
17	6	1	6	2026-06-05 15:07:14.442842+05:30
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, username, email, password_hash, full_name, role, department_id, is_active, last_login, mfa_secret, mfa_enabled, created_at, updated_at) FROM stdin;
8	admin	admin@silverstar.in	$argon2id$v=19$m=65536,t=3,p=4$5wmpqGJ7SO7ChGJBaZIJ+Q$SzRBdqhXcfsLlKOcEJEIDQol/+gw1UVukuDUOdRowdo	System Administrator	super_admin	\N	t	2026-06-08 17:36:55.156787+05:30	\N	f	2026-06-08 13:08:03.936891+05:30	2026-06-08 17:36:55.156787+05:30
6	Superadmin	Superadmin@silverstargrow.com	$argon2id$v=19$m=65536,t=3,p=4$FxuBiGF9PwjmhPRKXLDyww$xN3kcTU11TWc36Rjjm3DrBKfUnmVWCt00cxT5ZB3Fm4	Silver Star Grow	super_admin	\N	t	2026-06-09 16:13:28.569779+05:30	\N	f	2026-06-03 09:58:59.559201+05:30	2026-06-09 16:13:28.569779+05:30
\.


--
-- Data for Name: vendor_advances; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendor_advances (id, vendor_id, payment_id, amount, remaining_amount, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: vendors; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.vendors (id, code, name, category, contact_person, phone, email, address, city, state, gstin, pan, payment_term, bank_details, status, created_at, updated_at, account_id) FROM stdin;
7	V001	A B PROCESS TECHNOLOGIES	general	\N	\N	\N	\N	SURAT	GUJARAT	\N	\N	15 Days	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
8	V002	A Royal	general	\N	\N	\N	\N	\N	\N	\N	\N	30 Days	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
9	V003	Ajay Lathiya	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
10	V004	Apex Engineering	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
11	V005	Arix Crop	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
12	V006	ARVIND CORROTECH LIMITED	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
13	V007	Babubhai Plumber	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
14	V008	Bharmal Global Company	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
15	V009	Capri Refrigeration	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
16	V010	Chemtronics Technologies (I) Pvt.Ltd.	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
17	V011	DGVCL	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
18	V012	FUJI ELECTRIC CONSUL NEOWATT PRIVATE LIMITED	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
19	V013	GCE India Pvt. Ltd.	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
20	V014	GREEND TECHNOLOGIES LLP	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
21	V015	Gujarat Mobile	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
22	V016	Jag Singh (Ref.Mukeshbhai)	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
23	V017	JAY DURGAMATA ENGINEERING WORKS	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
24	V018	Jay Pumps Pvt Ltd.	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
25	V019	JK Steel Art	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
26	V020	KM Computer	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
27	V021	Logo My Mart	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
28	V022	Madhav Refrigeration	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
29	V023	Metzer Opto Inc	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
30	V024	Microtech Instruments Corporation	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
31	V025	MVS ENGINEERING PVT LTD	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
32	V026	Nilkanth Interior Hub	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
33	V027	Nova Computer	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
34	V028	Pavan Traders	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
35	V029	Platinum Interiors	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
36	V030	Powertech Electricals	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
37	V031	Radha Trading Co.	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
38	V032	Raghu Mistry	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
39	V033	Ramdev Steel	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
40	V034	S Chanpalal	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
41	V035	SAINI INDIA LIMITED	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
42	V036	Sharesingh	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
43	V037	Shayona Enterprise	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
44	V038	Shiv Shakti Traders	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
45	V039	Shree Darshan Granite	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
46	V040	Shree Devikrupa Corporation	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
47	V041	SHREEJI COOLING SYSTEM	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
48	V042	SHREEJI COOLING SYSTEM PVT LTD	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
49	V043	Shri Rameshvar Electricals	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
50	V044	Soham Furniture	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
51	V045	Sonubhai Colour	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
52	V046	SUPER TECHNICAL (INDIA) PVT. LTD.	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
53	V047	Surat Electromart	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
54	V048	Trane Technologies India Private Limited	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
55	V049	Trane Technologies India Private Limited (India)	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
56	V050	Udaybhai	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
57	V051	Usha Industries	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
58	V052	V360 Technetronic LLP	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
59	V053	Vardan Enterprise	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
60	V054	Viral Enterprise	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
61	V055	Virani Furniture	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
62	V056	Xpert H2O Solution	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
63	V057	ERREDUE S P A	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
64	V058	Nitrotech Industrial Products	general	\N	\N	\N	\N	\N	\N	\N	\N	Immediate	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
65	V059	Sigma Carbon Technologies LLP	seed	MAYUR	\N	\N	Sitapura, Jaipur	Jaipur	Rajasthan	08ADXF8287P1ZH	ADXFS8287P	30 Days	\N	active	2026-06-03 11:50:15.677566+05:30	2026-06-03 11:50:15.677566+05:30	\N
66	TEST001	Test Vendor	general	\N	1234567890	test@test.com	Test Address	\N	\N	29AAAAA0000A1Z5	\N	Immediate	\N	active	2026-06-08 17:36:55.203082+05:30	2026-06-08 17:36:55.203082+05:30	\N
67	V0015	Rohit	general	Rohit	+918305487046	nidhiimpex.rohitdata@gmail.com	varachha	Surat	Gujarat	\N	\N	Immediate	\N	active	2026-06-08 17:45:19.405178+05:30	2026-06-08 17:45:19.405178+05:30	\N
70	VND-0060	Rohit	general	Rohit	+918305487046	nidhiimpex.rohitdata@gmail.com	varachha	Surat	Gujarat	\N	\N	Immediate	\N	active	2026-06-08 17:59:28.03769+05:30	2026-06-08 17:59:28.03769+05:30	\N
71	VND-0061	qq	general	qq	\N	\N	q	Surat	Gujarat	\N	\N	Immediate	\N	active	2026-06-08 17:59:53.47566+05:30	2026-06-08 17:59:53.47566+05:30	\N
72	VND-0062	xc	general	Rohit	+918305487046	nidhiimpex.rohitdata@gmail.com	varachha	Surat	Gujarat	\N	\N	Immediate	\N	active	2026-06-08 18:09:28.270691+05:30	2026-06-08 18:09:28.270691+05:30	\N
73	VND-0063	e	general	e	\N	\N	e	Surat	Gujarat	\N	\N	Immediate	\N	active	2026-06-08 18:09:47.910562+05:30	2026-06-08 18:09:47.910562+05:30	\N
74	VND-0064	df	general	Rohit	+918305487046	nidhiimpex.rohitdata@gmail.com	varachha	Surat	Gujarat	\N	\N	Immediate	\N	active	2026-06-08 18:33:47.059642+05:30	2026-06-08 18:33:47.059642+05:30	\N
75	VND-0065	xc	general	Rohit	+918305487046	nidhiimpex.rohitdata@gmail.com	varachha	Surat	Gujarat	\N	\N	Immediate	\N	active	2026-06-09 10:29:11.510843+05:30	2026-06-09 10:29:11.510843+05:30	\N
\.


--
-- Name: accounts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.accounts_id_seq', 40, true);


--
-- Name: api_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.api_logs_id_seq', 1, false);


--
-- Name: asset_templates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.asset_templates_id_seq', 1, false);


--
-- Name: audit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.audit_log_id_seq', 1, false);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.audit_logs_id_seq', 60000, true);


--
-- Name: bank_deposit_lines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bank_deposit_lines_id_seq', 1, false);


--
-- Name: bank_deposits_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bank_deposits_id_seq', 1, false);


--
-- Name: bank_reconciliation_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bank_reconciliation_id_seq', 1, false);


--
-- Name: bank_reconciliation_lines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.bank_reconciliation_lines_id_seq', 1, false);


--
-- Name: code_sequences_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.code_sequences_id_seq', 27, true);


--
-- Name: cost_centers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.cost_centers_id_seq', 1, false);


--
-- Name: customer_advances_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.customer_advances_id_seq', 1, false);


--
-- Name: customers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.customers_id_seq', 1, false);


--
-- Name: departments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.departments_id_seq', 9, true);


--
-- Name: depreciation_run_lines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.depreciation_run_lines_id_seq', 1, false);


--
-- Name: depreciation_runs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.depreciation_runs_id_seq', 1, false);


--
-- Name: dr_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.dr_seq', 2, true);


--
-- Name: exp_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.exp_seq', 1001, false);


--
-- Name: expense_allocations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.expense_allocations_id_seq', 1, false);


--
-- Name: expense_categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.expense_categories_id_seq', 7, true);


--
-- Name: expense_lines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.expense_lines_id_seq', 1, false);


--
-- Name: expenses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.expenses_id_seq', 1, false);


--
-- Name: fa_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.fa_seq', 1001, false);


--
-- Name: fixed_asset_categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.fixed_asset_categories_id_seq', 1, false);


--
-- Name: fixed_asset_gst_ledger_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.fixed_asset_gst_ledger_id_seq', 1, false);


--
-- Name: fixed_assets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.fixed_assets_id_seq', 1, false);


--
-- Name: gr_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.gr_seq', 1016, true);


--
-- Name: growth_run_cycles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.growth_run_cycles_id_seq', 4, true);


--
-- Name: growth_run_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.growth_run_seq', 43, true);


--
-- Name: inv_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.inv_seq', 3001, false);


--
-- Name: inventory_closing_override_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.inventory_closing_override_id_seq', 4, true);


--
-- Name: inventory_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.inventory_id_seq', 233, true);


--
-- Name: inventory_opening_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.inventory_opening_id_seq', 3, true);


--
-- Name: invoice_lines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.invoice_lines_id_seq', 1, false);


--
-- Name: invoices_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.invoices_id_seq', 1, false);


--
-- Name: items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.items_id_seq', 23, true);


--
-- Name: je_allocations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.je_allocations_id_seq', 1, false);


--
-- Name: je_lines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.je_lines_id_seq', 38, true);


--
-- Name: je_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.je_seq', 4014, true);


--
-- Name: journal_entries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.journal_entries_id_seq', 14, true);


--
-- Name: lm_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lm_seq', 1014, true);


--
-- Name: locations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.locations_id_seq', 4, true);


--
-- Name: login_attempts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.login_attempts_id_seq', 70, true);


--
-- Name: lot_issue_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lot_issue_seq', 119, true);


--
-- Name: lot_mix_components_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lot_mix_components_id_seq', 36, true);


--
-- Name: lot_movement_children_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lot_movement_children_id_seq', 32, true);


--
-- Name: lot_movement_parents_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lot_movement_parents_id_seq', 23, true);


--
-- Name: lot_movements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lot_movements_id_seq', 17, true);


--
-- Name: lot_op_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lot_op_id_seq', 100247, true);


--
-- Name: lot_op_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lot_op_log_id_seq', 319, true);


--
-- Name: lot_process_issues_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lot_process_issues_id_seq', 121, true);


--
-- Name: lot_process_returns_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lot_process_returns_id_seq', 31, true);


--
-- Name: lot_return_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lot_return_seq', 41, true);


--
-- Name: machine_process_lots_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.machine_process_lots_id_seq', 114, true);


--
-- Name: machine_process_materials_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.machine_process_materials_id_seq', 1, false);


--
-- Name: machine_process_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.machine_process_seq', 106, true);


--
-- Name: machine_processes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.machine_processes_id_seq', 87, true);


--
-- Name: machine_status_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.machine_status_logs_id_seq', 125, true);


--
-- Name: machines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.machines_id_seq', 126, true);


--
-- Name: migrations_history_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.migrations_history_id_seq', 32, true);


--
-- Name: pay_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.pay_seq', 1001, false);


--
-- Name: payment_allocations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.payment_allocations_id_seq', 1, false);


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.payments_id_seq', 1, false);


--
-- Name: pending_transfer_lots_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.pending_transfer_lots_id_seq', 4, true);


--
-- Name: pending_transfers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.pending_transfers_id_seq', 4, true);


--
-- Name: permission_audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.permission_audit_logs_id_seq', 15, true);


--
-- Name: pn_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.pn_seq', 2073, true);


--
-- Name: pr_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.pr_seq', 1001, false);


--
-- Name: process_master_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.process_master_id_seq', 10, true);


--
-- Name: process_return_lines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.process_return_lines_id_seq', 30, true);


--
-- Name: process_transaction_lines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.process_transaction_lines_id_seq', 1, false);


--
-- Name: process_transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.process_transactions_id_seq', 1, false);


--
-- Name: ps_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.ps_seq', 1001, false);


--
-- Name: purchase_note_lines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.purchase_note_lines_id_seq', 27, true);


--
-- Name: purchase_notes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.purchase_notes_id_seq', 26, true);


--
-- Name: rct_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.rct_seq', 1001, false);


--
-- Name: rd_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.rd_seq', 1005, true);


--
-- Name: receipt_allocations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.receipt_allocations_id_seq', 1, false);


--
-- Name: receipts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.receipts_id_seq', 1, false);


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.refresh_tokens_id_seq', 42, true);


--
-- Name: role_permissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.role_permissions_id_seq', 237461, true);


--
-- Name: roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.roles_id_seq', 3672, true);


--
-- Name: rough_growth_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.rough_growth_id_seq', 16, true);


--
-- Name: rough_growth_lines_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.rough_growth_lines_id_seq', 5, true);


--
-- Name: seed_lot_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.seed_lot_seq', 1025, true);


--
-- Name: seed_mix_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.seed_mix_seq', 6, true);


--
-- Name: session_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.session_log_id_seq', 1, false);


--
-- Name: st_req_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.st_req_seq', 1, false);


--
-- Name: st_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.st_seq', 5, true);


--
-- Name: stock_transfer_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.stock_transfer_id_seq', 1, false);


--
-- Name: stock_transfer_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.stock_transfer_items_id_seq', 1, false);


--
-- Name: stock_transfer_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.stock_transfer_seq', 1, false);


--
-- Name: uom_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.uom_id_seq', 7, true);


--
-- Name: user_clipboard_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_clipboard_id_seq', 280, true);


--
-- Name: user_dashboard_widgets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_dashboard_widgets_id_seq', 1, false);


--
-- Name: user_permissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_permissions_id_seq', 1, false);


--
-- Name: user_preferences_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_preferences_id_seq', 180, true);


--
-- Name: user_roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_roles_id_seq', 17, true);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 8, true);


--
-- Name: vendor_advances_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendor_advances_id_seq', 1, false);


--
-- Name: vendors_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.vendors_id_seq', 75, true);


--
-- Name: accounts accounts_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_code_key UNIQUE (code);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: api_logs api_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.api_logs
    ADD CONSTRAINT api_logs_pkey PRIMARY KEY (id);


--
-- Name: asset_templates asset_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_templates
    ADD CONSTRAINT asset_templates_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: bank_deposit_lines bank_deposit_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bank_deposit_lines
    ADD CONSTRAINT bank_deposit_lines_pkey PRIMARY KEY (id);


--
-- Name: bank_deposits bank_deposits_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bank_deposits
    ADD CONSTRAINT bank_deposits_pkey PRIMARY KEY (id);


--
-- Name: bank_reconciliation_lines bank_reconciliation_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bank_reconciliation_lines
    ADD CONSTRAINT bank_reconciliation_lines_pkey PRIMARY KEY (id);


--
-- Name: bank_reconciliation bank_reconciliation_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bank_reconciliation
    ADD CONSTRAINT bank_reconciliation_pkey PRIMARY KEY (id);


--
-- Name: code_sequences code_sequences_entity_type_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.code_sequences
    ADD CONSTRAINT code_sequences_entity_type_key UNIQUE (entity_type);


--
-- Name: code_sequences code_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.code_sequences
    ADD CONSTRAINT code_sequences_pkey PRIMARY KEY (id);


--
-- Name: cost_centers cost_centers_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_centers
    ADD CONSTRAINT cost_centers_code_key UNIQUE (code);


--
-- Name: cost_centers cost_centers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.cost_centers
    ADD CONSTRAINT cost_centers_pkey PRIMARY KEY (id);


--
-- Name: customer_advances customer_advances_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customer_advances
    ADD CONSTRAINT customer_advances_pkey PRIMARY KEY (id);


--
-- Name: customers customers_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_code_key UNIQUE (code);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: departments departments_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_code_key UNIQUE (code);


--
-- Name: departments departments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT departments_pkey PRIMARY KEY (id);


--
-- Name: depreciation_run_lines depreciation_run_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depreciation_run_lines
    ADD CONSTRAINT depreciation_run_lines_pkey PRIMARY KEY (id);


--
-- Name: depreciation_run_lines depreciation_run_lines_run_id_fixed_asset_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depreciation_run_lines
    ADD CONSTRAINT depreciation_run_lines_run_id_fixed_asset_id_key UNIQUE (run_id, fixed_asset_id);


--
-- Name: depreciation_runs depreciation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depreciation_runs
    ADD CONSTRAINT depreciation_runs_pkey PRIMARY KEY (id);


--
-- Name: depreciation_runs depreciation_runs_run_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depreciation_runs
    ADD CONSTRAINT depreciation_runs_run_number_key UNIQUE (run_number);


--
-- Name: expense_allocations expense_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expense_allocations
    ADD CONSTRAINT expense_allocations_pkey PRIMARY KEY (id);


--
-- Name: expense_categories expense_categories_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_code_key UNIQUE (code);


--
-- Name: expense_categories expense_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_pkey PRIMARY KEY (id);


--
-- Name: expense_lines expense_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expense_lines
    ADD CONSTRAINT expense_lines_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_doc_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_doc_number_key UNIQUE (doc_number);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: fixed_asset_categories fixed_asset_categories_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_asset_categories
    ADD CONSTRAINT fixed_asset_categories_code_key UNIQUE (code);


--
-- Name: fixed_asset_categories fixed_asset_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_asset_categories
    ADD CONSTRAINT fixed_asset_categories_pkey PRIMARY KEY (id);


--
-- Name: fixed_asset_gst_ledger fixed_asset_gst_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_asset_gst_ledger
    ADD CONSTRAINT fixed_asset_gst_ledger_pkey PRIMARY KEY (id);


--
-- Name: fixed_assets fixed_assets_asset_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_assets
    ADD CONSTRAINT fixed_assets_asset_code_key UNIQUE (asset_code);


--
-- Name: fixed_assets fixed_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_assets
    ADD CONSTRAINT fixed_assets_pkey PRIMARY KEY (id);


--
-- Name: growth_run_cycles growth_run_cycles_growth_run_id_cycle_no_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.growth_run_cycles
    ADD CONSTRAINT growth_run_cycles_growth_run_id_cycle_no_key UNIQUE (growth_run_id, cycle_no);


--
-- Name: growth_run_cycles growth_run_cycles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.growth_run_cycles
    ADD CONSTRAINT growth_run_cycles_pkey PRIMARY KEY (id);


--
-- Name: inventory_closing_override inventory_closing_override_date_item_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_closing_override
    ADD CONSTRAINT inventory_closing_override_date_item_id_key UNIQUE (date, item_id);


--
-- Name: inventory_closing_override inventory_closing_override_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_closing_override
    ADD CONSTRAINT inventory_closing_override_pkey PRIMARY KEY (id);


--
-- Name: inventory inventory_lot_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_lot_number_key UNIQUE (lot_number);


--
-- Name: inventory inventory_lot_op_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_lot_op_id_key UNIQUE (lot_op_id);


--
-- Name: inventory_opening inventory_opening_item_id_as_of_date_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_opening
    ADD CONSTRAINT inventory_opening_item_id_as_of_date_key UNIQUE (item_id, as_of_date);


--
-- Name: inventory_opening inventory_opening_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory_opening
    ADD CONSTRAINT inventory_opening_pkey PRIMARY KEY (id);


--
-- Name: inventory inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);


--
-- Name: invoice_lines invoice_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_lines
    ADD CONSTRAINT invoice_lines_pkey PRIMARY KEY (id);


--
-- Name: invoices_old invoices_doc_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices_old
    ADD CONSTRAINT invoices_doc_number_key UNIQUE (doc_number);


--
-- Name: invoices_old invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices_old
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: items items_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_code_key UNIQUE (code);


--
-- Name: items items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_pkey PRIMARY KEY (id);


--
-- Name: je_allocations je_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.je_allocations
    ADD CONSTRAINT je_allocations_pkey PRIMARY KEY (id);


--
-- Name: je_lines_old je_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.je_lines_old
    ADD CONSTRAINT je_lines_pkey PRIMARY KEY (id);


--
-- Name: journal_entries_old journal_entries_je_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.journal_entries_old
    ADD CONSTRAINT journal_entries_je_number_key UNIQUE (je_number);


--
-- Name: journal_entries_old journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.journal_entries_old
    ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);


--
-- Name: locations locations_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_code_key UNIQUE (code);


--
-- Name: locations locations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);


--
-- Name: login_attempts login_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.login_attempts
    ADD CONSTRAINT login_attempts_pkey PRIMARY KEY (id);


--
-- Name: lot_mix_components lot_mix_components_mixed_lot_id_source_lot_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_mix_components
    ADD CONSTRAINT lot_mix_components_mixed_lot_id_source_lot_id_key UNIQUE (mixed_lot_id, source_lot_id);


--
-- Name: lot_mix_components lot_mix_components_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_mix_components
    ADD CONSTRAINT lot_mix_components_pkey PRIMARY KEY (id);


--
-- Name: lot_movement_children lot_movement_children_movement_id_child_lot_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_movement_children
    ADD CONSTRAINT lot_movement_children_movement_id_child_lot_id_key UNIQUE (movement_id, child_lot_id);


--
-- Name: lot_movement_children lot_movement_children_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_movement_children
    ADD CONSTRAINT lot_movement_children_pkey PRIMARY KEY (id);


--
-- Name: lot_movement_parents lot_movement_parents_movement_id_parent_lot_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_movement_parents
    ADD CONSTRAINT lot_movement_parents_movement_id_parent_lot_id_key UNIQUE (movement_id, parent_lot_id);


--
-- Name: lot_movement_parents lot_movement_parents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_movement_parents
    ADD CONSTRAINT lot_movement_parents_pkey PRIMARY KEY (id);


--
-- Name: lot_movements_old lot_movements_movement_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_movements_old
    ADD CONSTRAINT lot_movements_movement_number_key UNIQUE (movement_number);


--
-- Name: lot_movements_old lot_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_movements_old
    ADD CONSTRAINT lot_movements_pkey PRIMARY KEY (id);


--
-- Name: lot_op_log lot_op_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_op_log
    ADD CONSTRAINT lot_op_log_pkey PRIMARY KEY (id);


--
-- Name: lot_process_issues lot_process_issues_issue_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_process_issues
    ADD CONSTRAINT lot_process_issues_issue_number_key UNIQUE (issue_number);


--
-- Name: lot_process_issues lot_process_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_process_issues
    ADD CONSTRAINT lot_process_issues_pkey PRIMARY KEY (id);


--
-- Name: lot_process_returns lot_process_returns_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_process_returns
    ADD CONSTRAINT lot_process_returns_pkey PRIMARY KEY (id);


--
-- Name: lot_process_returns lot_process_returns_return_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_process_returns
    ADD CONSTRAINT lot_process_returns_return_number_key UNIQUE (return_number);


--
-- Name: machine_process_lots machine_process_lots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_process_lots
    ADD CONSTRAINT machine_process_lots_pkey PRIMARY KEY (id);


--
-- Name: machine_process_materials machine_process_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_process_materials
    ADD CONSTRAINT machine_process_materials_pkey PRIMARY KEY (id);


--
-- Name: machine_processes machine_processes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_processes
    ADD CONSTRAINT machine_processes_pkey PRIMARY KEY (id);


--
-- Name: machine_processes machine_processes_process_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_processes
    ADD CONSTRAINT machine_processes_process_number_key UNIQUE (process_number);


--
-- Name: machine_status_logs machine_status_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_status_logs
    ADD CONSTRAINT machine_status_logs_pkey PRIMARY KEY (id);


--
-- Name: machines machines_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT machines_code_key UNIQUE (code);


--
-- Name: machines machines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT machines_pkey PRIMARY KEY (id);


--
-- Name: migrations_history migrations_history_filename_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.migrations_history
    ADD CONSTRAINT migrations_history_filename_key UNIQUE (filename);


--
-- Name: migrations_history migrations_history_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.migrations_history
    ADD CONSTRAINT migrations_history_pkey PRIMARY KEY (id);


--
-- Name: payment_allocations payment_allocations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_allocations
    ADD CONSTRAINT payment_allocations_pkey PRIMARY KEY (id);


--
-- Name: payments payments_doc_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_doc_number_key UNIQUE (doc_number);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: pending_transfer_lots pending_transfer_lots_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pending_transfer_lots
    ADD CONSTRAINT pending_transfer_lots_pkey PRIMARY KEY (id);


--
-- Name: pending_transfers pending_transfers_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pending_transfers
    ADD CONSTRAINT pending_transfers_pkey PRIMARY KEY (id);


--
-- Name: pending_transfers pending_transfers_transfer_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pending_transfers
    ADD CONSTRAINT pending_transfers_transfer_id_key UNIQUE (transfer_id);


--
-- Name: permission_audit_logs permission_audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_audit_logs
    ADD CONSTRAINT permission_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: process_master process_master_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_master
    ADD CONSTRAINT process_master_pkey PRIMARY KEY (id);


--
-- Name: process_master process_master_process_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_master
    ADD CONSTRAINT process_master_process_code_key UNIQUE (process_code);


--
-- Name: process_return_lines process_return_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_return_lines
    ADD CONSTRAINT process_return_lines_pkey PRIMARY KEY (id);


--
-- Name: process_transaction_lines process_transaction_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_transaction_lines
    ADD CONSTRAINT process_transaction_lines_pkey PRIMARY KEY (id);


--
-- Name: process_transactions process_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_transactions
    ADD CONSTRAINT process_transactions_pkey PRIMARY KEY (id);


--
-- Name: process_transactions process_transactions_trs_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_transactions
    ADD CONSTRAINT process_transactions_trs_number_key UNIQUE (trs_number);


--
-- Name: purchase_note_lines purchase_note_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_note_lines
    ADD CONSTRAINT purchase_note_lines_pkey PRIMARY KEY (id);


--
-- Name: purchase_notes_old purchase_notes_doc_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_notes_old
    ADD CONSTRAINT purchase_notes_doc_number_key UNIQUE (doc_number);


--
-- Name: purchase_notes_old purchase_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_notes_old
    ADD CONSTRAINT purchase_notes_pkey PRIMARY KEY (id);


--
-- Name: receipts receipts_doc_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.receipts
    ADD CONSTRAINT receipts_doc_number_key UNIQUE (doc_number);


--
-- Name: receipts receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.receipts
    ADD CONSTRAINT receipts_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_role_id_module_submodule_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_module_submodule_key UNIQUE (role_id, module, submodule);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: roles roles_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_slug_key UNIQUE (slug);


--
-- Name: session_log session_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.session_log
    ADD CONSTRAINT session_log_pkey PRIMARY KEY (id);


--
-- Name: stock_transfer_items stock_transfer_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_pkey PRIMARY KEY (id);


--
-- Name: stock_transfer stock_transfer_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer
    ADD CONSTRAINT stock_transfer_pkey PRIMARY KEY (id);


--
-- Name: stock_transfer stock_transfer_transfer_number_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer
    ADD CONSTRAINT stock_transfer_transfer_number_key UNIQUE (transfer_number);


--
-- Name: sys_event_outbox sys_event_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sys_event_outbox
    ADD CONSTRAINT sys_event_outbox_pkey PRIMARY KEY (id);


--
-- Name: uom uom_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.uom
    ADD CONSTRAINT uom_code_key UNIQUE (code);


--
-- Name: uom uom_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.uom
    ADD CONSTRAINT uom_pkey PRIMARY KEY (id);


--
-- Name: user_clipboard user_clipboard_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_clipboard
    ADD CONSTRAINT user_clipboard_unique UNIQUE (user_id, entity_type, entity_id);


--
-- Name: user_dashboard_widgets user_dashboard_widgets_user_id_widget_key_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_dashboard_widgets
    ADD CONSTRAINT user_dashboard_widgets_user_id_widget_key_key UNIQUE (user_id, widget_key);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_id_key UNIQUE (user_id, role_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: vendors vendors_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_code_key UNIQUE (code);


--
-- Name: vendors vendors_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_pkey PRIMARY KEY (id);


--
-- Name: idx_accounts_code_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_accounts_code_trgm ON public.accounts USING gin (code public.gin_trgm_ops);


--
-- Name: idx_accounts_level; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_accounts_level ON public.accounts USING btree (level);


--
-- Name: idx_accounts_name_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_accounts_name_trgm ON public.accounts USING gin (name public.gin_trgm_ops);


--
-- Name: idx_accounts_parent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_accounts_parent ON public.accounts USING btree (parent_id);


--
-- Name: idx_accounts_path; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_accounts_path ON public.accounts USING btree (path);


--
-- Name: idx_accounts_posting; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_accounts_posting ON public.accounts USING btree (is_posting);


--
-- Name: idx_accounts_sub_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_accounts_sub_type ON public.accounts USING btree (sub_type);


--
-- Name: idx_accounts_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_accounts_type ON public.accounts USING btree (type);


--
-- Name: idx_acct_is_group; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acct_is_group ON public.accounts USING btree (is_group);


--
-- Name: idx_acct_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acct_type ON public.accounts USING btree (type);


--
-- Name: idx_acct_type_group; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_acct_type_group ON public.accounts USING btree (type, is_group);


--
-- Name: idx_api_logs_endpoint; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_api_logs_endpoint ON public.api_logs USING btree (endpoint);


--
-- Name: idx_api_logs_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_api_logs_status ON public.api_logs USING btree (status_code);


--
-- Name: idx_api_logs_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_api_logs_time ON public.api_logs USING btree (created_at);


--
-- Name: idx_asset_templates_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_asset_templates_code ON public.asset_templates USING btree (code);


--
-- Name: idx_asset_templates_name_ci; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_asset_templates_name_ci ON public.asset_templates USING btree (lower((name)::text));


--
-- Name: idx_audit_action; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_action ON public.permission_audit_logs USING btree (action);


--
-- Name: idx_audit_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_created ON public.permission_audit_logs USING btree (created_at);


--
-- Name: idx_audit_logs_timestamp; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_logs_timestamp ON public.audit_logs USING btree ("timestamp" DESC);


--
-- Name: idx_audit_logs_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_logs_user ON public.audit_logs USING btree (user_id);


--
-- Name: idx_audit_record; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_record ON public.audit_log USING btree (table_name, record_id);


--
-- Name: idx_audit_table; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_table ON public.audit_log USING btree (table_name);


--
-- Name: idx_audit_target; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_target ON public.permission_audit_logs USING btree (target_type, target_id);


--
-- Name: idx_audit_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_time ON public.audit_log USING btree (changed_at);


--
-- Name: idx_audit_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_user ON public.permission_audit_logs USING btree (user_id);


--
-- Name: idx_bank_deposits_bank_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bank_deposits_bank_account ON public.bank_deposits USING btree (bank_account_id);


--
-- Name: idx_bank_deposits_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bank_deposits_date ON public.bank_deposits USING btree (date);


--
-- Name: idx_bank_deposits_je; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bank_deposits_je ON public.bank_deposits USING btree (je_id);


--
-- Name: idx_bank_deposits_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bank_deposits_status ON public.bank_deposits USING btree (status);


--
-- Name: idx_bank_recon_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bank_recon_account ON public.bank_reconciliation USING btree (account_id);


--
-- Name: idx_bank_recon_lines_je; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bank_recon_lines_je ON public.bank_reconciliation_lines USING btree (je_id);


--
-- Name: idx_bank_recon_lines_recon; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_bank_recon_lines_recon ON public.bank_reconciliation_lines USING btree (reconciliation_id);


--
-- Name: idx_cust_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cust_name ON public.customers USING btree (name);


--
-- Name: idx_cust_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_cust_status ON public.customers USING btree (status);


--
-- Name: idx_customers_code_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customers_code_trgm ON public.customers USING gin (code public.gin_trgm_ops);


--
-- Name: idx_customers_name_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_customers_name_trgm ON public.customers USING gin (name public.gin_trgm_ops);


--
-- Name: idx_depr_run_lines_asset_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_depr_run_lines_asset_id ON public.depreciation_run_lines USING btree (fixed_asset_id);


--
-- Name: idx_depr_run_lines_run_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_depr_run_lines_run_id ON public.depreciation_run_lines USING btree (run_id);


--
-- Name: idx_depr_runs_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_depr_runs_created_at ON public.depreciation_runs USING btree (created_at DESC);


--
-- Name: idx_depr_runs_je_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_depr_runs_je_id ON public.depreciation_runs USING btree (je_id);


--
-- Name: idx_depr_runs_status_period; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_depr_runs_status_period ON public.depreciation_runs USING btree (status, period_from);


--
-- Name: idx_event_outbox_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_event_outbox_created ON public.sys_event_outbox USING btree (created_at DESC);


--
-- Name: idx_event_outbox_topic; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_event_outbox_topic ON public.sys_event_outbox USING btree (topic, created_at DESC);


--
-- Name: idx_fa_asset_code_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fa_asset_code_trgm ON public.fixed_assets USING gin (asset_code public.gin_trgm_ops);


--
-- Name: idx_fa_asset_name_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fa_asset_name_trgm ON public.fixed_assets USING gin (asset_name public.gin_trgm_ops);


--
-- Name: idx_fa_asset_tag; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_fa_asset_tag ON public.fixed_assets USING btree (asset_tag) WHERE (asset_tag IS NOT NULL);


--
-- Name: idx_fa_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fa_category ON public.fixed_assets USING btree (category_id);


--
-- Name: idx_fa_category_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fa_category_id ON public.fixed_assets USING btree (category_id);


--
-- Name: idx_fa_purchase_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fa_purchase_date ON public.fixed_assets USING btree (purchase_date);


--
-- Name: idx_fa_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fa_status ON public.fixed_assets USING btree (status);


--
-- Name: idx_fa_template_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fa_template_id ON public.fixed_assets USING btree (template_id) WHERE (template_id IS NOT NULL);


--
-- Name: idx_fixed_assets_category_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fixed_assets_category_id ON public.fixed_assets USING btree (category_id);


--
-- Name: idx_fixed_assets_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_fixed_assets_status ON public.fixed_assets USING btree (status);


--
-- Name: idx_growth_run_cycles_process; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_growth_run_cycles_process ON public.growth_run_cycles USING btree (machine_process_id) WHERE (machine_process_id IS NOT NULL);


--
-- Name: idx_growth_run_cycles_run; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_growth_run_cycles_run ON public.growth_run_cycles USING btree (growth_run_id);


--
-- Name: idx_inv_active_customer_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_active_customer_date ON public.invoices USING btree (customer_id, doc_date DESC, id DESC) WHERE (status <> 'cancelled'::public.doc_status);


--
-- Name: idx_inv_active_date_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_active_date_id ON public.invoices USING btree (doc_date DESC, id DESC) WHERE (status <> 'cancelled'::public.doc_status);


--
-- Name: idx_inv_balance_due; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_balance_due ON public.invoices USING btree (balance_due) WHERE (status <> 'cancelled'::public.doc_status);


--
-- Name: idx_inv_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_created_at ON public.inventory USING btree (created_at DESC);


--
-- Name: idx_inv_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_customer_id ON public.invoices USING btree (customer_id);


--
-- Name: idx_inv_doc_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_doc_date ON public.invoices USING btree (doc_date);


--
-- Name: idx_inv_doc_number; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_doc_number ON public.invoices USING btree (doc_number);


--
-- Name: idx_inv_item_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_item_id ON public.inventory USING btree (item_id);


--
-- Name: idx_inv_item_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_item_status ON public.inventory USING btree (item_id, status);


--
-- Name: idx_inv_location_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_location_id ON public.inventory USING btree (location_id);


--
-- Name: idx_inv_lot_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_lot_code ON public.inventory USING btree (lot_code);


--
-- Name: idx_inv_lot_number; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_lot_number ON public.inventory USING btree (lot_number);


--
-- Name: idx_inv_parent_lot; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_parent_lot ON public.inventory USING btree (parent_lot_id);


--
-- Name: idx_inv_pay_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_pay_status ON public.invoices USING btree (payment_status);


--
-- Name: idx_inv_root_lot; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_root_lot ON public.inventory USING btree (root_lot_id);


--
-- Name: idx_inv_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_status ON public.inventory USING btree (status);


--
-- Name: idx_inv_status_date_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_status_date_id ON public.invoices USING btree (status, doc_date DESC, id DESC);


--
-- Name: idx_inv_vendor_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inv_vendor_id ON public.inventory USING btree (vendor_id);


--
-- Name: idx_inventory_growth_metrics; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_growth_metrics ON public.inventory USING btree (growth_pct) WHERE (growth_pct IS NOT NULL);


--
-- Name: idx_inventory_item; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_item ON public.inventory USING btree (item_id);


--
-- Name: idx_inventory_item_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_item_id ON public.inventory USING btree (item_id);


--
-- Name: idx_inventory_location; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_location ON public.inventory USING btree (location_id);


--
-- Name: idx_inventory_location_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_location_id ON public.inventory USING btree (location_id);


--
-- Name: idx_inventory_lot; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_lot ON public.inventory USING btree (lot_number);


--
-- Name: idx_inventory_lot_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_lot_code ON public.inventory USING btree (lot_code);


--
-- Name: idx_inventory_lot_name_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_lot_name_trgm ON public.inventory USING gin (lot_name public.gin_trgm_ops);


--
-- Name: idx_inventory_lot_number_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_lot_number_trgm ON public.inventory USING gin (lot_number public.gin_trgm_ops);


--
-- Name: idx_inventory_lot_op_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_lot_op_id ON public.inventory USING btree (lot_op_id);


--
-- Name: idx_inventory_machine_process; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_machine_process ON public.inventory USING btree (machine_process_id) WHERE (machine_process_id IS NOT NULL);


--
-- Name: idx_inventory_parent_lot; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_parent_lot ON public.inventory USING btree (parent_lot_id);


--
-- Name: idx_inventory_root_lot; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_root_lot ON public.inventory USING btree (root_lot_id);


--
-- Name: idx_inventory_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_status ON public.inventory USING btree (status);


--
-- Name: idx_inventory_vendor_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_inventory_vendor_id ON public.inventory USING btree (vendor_id);


--
-- Name: idx_invl_inventory_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invl_inventory_id ON public.invoice_lines USING btree (inventory_id);


--
-- Name: idx_invoices_doc_number_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoices_doc_number_trgm ON public.invoices_old USING gin (doc_number public.gin_trgm_ops);


--
-- Name: idx_items_category; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_items_category ON public.items USING btree (category);


--
-- Name: idx_items_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_items_type ON public.items USING btree (type);


--
-- Name: idx_ja_entity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ja_entity ON public.je_allocations USING btree (entity_type, entity_id);


--
-- Name: idx_ja_target; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_ja_target ON public.je_allocations USING btree (target_type, target_id);


--
-- Name: idx_je_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_date ON public.journal_entries USING btree (date);


--
-- Name: idx_je_date_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_date_status ON public.journal_entries_old USING btree (date, status);


--
-- Name: idx_je_lines_account; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_lines_account ON public.je_lines_old USING btree (account_id);


--
-- Name: idx_je_lines_account_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_lines_account_id ON public.je_lines_old USING btree (account_id);


--
-- Name: idx_je_lines_cost_center; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_lines_cost_center ON public.je_lines_old USING btree (cost_center_id);


--
-- Name: idx_je_lines_cost_center_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_lines_cost_center_id ON public.je_lines_old USING btree (cost_center_id);


--
-- Name: idx_je_lines_entity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_lines_entity ON public.je_lines_old USING btree (entity_type, entity_id);


--
-- Name: idx_je_lines_je; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_lines_je ON public.je_lines_old USING btree (je_id);


--
-- Name: idx_je_lines_je_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_lines_je_id ON public.je_lines_old USING btree (je_id);


--
-- Name: idx_je_number_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_number_trgm ON public.journal_entries_old USING gin (je_number public.gin_trgm_ops);


--
-- Name: idx_je_ref; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_ref ON public.journal_entries_old USING btree (reference_no);


--
-- Name: idx_je_reversal_of; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_reversal_of ON public.journal_entries_old USING btree (reversal_of_je_id) WHERE (reversal_of_je_id IS NOT NULL);


--
-- Name: idx_je_source; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_source ON public.journal_entries_old USING btree (source_type, source_id);


--
-- Name: idx_je_source_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_source_id ON public.journal_entries USING btree (source_id);


--
-- Name: idx_je_source_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_source_type ON public.journal_entries USING btree (source_type);


--
-- Name: idx_je_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_status ON public.journal_entries USING btree (status);


--
-- Name: idx_je_status_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_status_date ON public.journal_entries USING btree (status, date);


--
-- Name: idx_je_status_posted_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_je_status_posted_date ON public.journal_entries_old USING btree (status, date) WHERE (status = 'posted'::public.je_status);


--
-- Name: idx_jl_account_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_jl_account_id ON public.je_lines USING btree (account_id);


--
-- Name: idx_jl_entity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_jl_entity ON public.je_lines USING btree (entity_type, entity_id);


--
-- Name: idx_jl_je_acct; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_jl_je_acct ON public.je_lines USING btree (je_id, account_id);


--
-- Name: idx_jl_je_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_jl_je_id ON public.je_lines USING btree (je_id);


--
-- Name: idx_lm_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lm_date ON public.lot_movements USING btree (movement_date DESC);


--
-- Name: idx_lm_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lm_type ON public.lot_movements_old USING btree (movement_type);


--
-- Name: idx_lmc_child; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lmc_child ON public.lot_movement_children USING btree (child_lot_id);


--
-- Name: idx_lmp_parent; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lmp_parent ON public.lot_movement_parents USING btree (parent_lot_id);


--
-- Name: idx_lol_lot_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lol_lot_id ON public.lot_op_log USING btree (lot_id);


--
-- Name: idx_lol_performed_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lol_performed_at ON public.lot_op_log USING btree (performed_at DESC);


--
-- Name: idx_lpi_machine_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lpi_machine_id ON public.lot_process_issues USING btree (machine_id);


--
-- Name: idx_lpi_machine_proc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lpi_machine_proc ON public.lot_process_issues USING btree (machine_process_id);


--
-- Name: idx_lpi_process_lot; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lpi_process_lot ON public.lot_process_issues USING btree (process_lot_id);


--
-- Name: idx_lpi_source_lot; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lpi_source_lot ON public.lot_process_issues USING btree (source_lot_id);


--
-- Name: idx_lpi_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_lpi_status ON public.lot_process_issues USING btree (status);


--
-- Name: idx_machines_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_machines_status ON public.machines USING btree (status);


--
-- Name: idx_mp_machine_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_machine_id ON public.machine_processes USING btree (machine_id);


--
-- Name: idx_mp_operator_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_operator_id ON public.machine_processes USING btree (operator_id);


--
-- Name: idx_mp_output_entry; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_output_entry ON public.machine_processes USING btree (output_entry_id) WHERE (output_entry_id IS NOT NULL);


--
-- Name: idx_mp_started_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_started_at ON public.machine_processes USING btree (started_at);


--
-- Name: idx_mp_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mp_status ON public.machine_processes USING btree (status);


--
-- Name: idx_mpl_lot_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mpl_lot_id ON public.machine_process_lots USING btree (inventory_lot_id);


--
-- Name: idx_mpl_process_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_mpl_process_id ON public.machine_process_lots USING btree (process_id);


--
-- Name: idx_mv_dashboard_financial; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_mv_dashboard_financial ON public.mv_dashboard_financial USING btree (month, account_id);


--
-- Name: idx_mv_trial_balance; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_mv_trial_balance ON public.mv_trial_balance USING btree (account_id);


--
-- Name: idx_pa_pn_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pa_pn_id ON public.payment_allocations USING btree (purchase_note_id);


--
-- Name: idx_pay_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pay_date ON public.payments USING btree (date);


--
-- Name: idx_pay_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pay_status ON public.payments USING btree (status);


--
-- Name: idx_pay_vendor_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pay_vendor_id ON public.payments USING btree (vendor_id);


--
-- Name: idx_pn_active_date_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_active_date_id ON public.purchase_notes USING btree (doc_date DESC, id DESC) WHERE (status <> 'cancelled'::public.doc_status);


--
-- Name: idx_pn_active_vendor_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_active_vendor_date ON public.purchase_notes USING btree (vendor_id, doc_date DESC, id DESC) WHERE (status <> 'cancelled'::public.doc_status);


--
-- Name: idx_pn_balance_due; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_balance_due ON public.purchase_notes USING btree (balance_due) WHERE (status <> 'cancelled'::public.doc_status);


--
-- Name: idx_pn_department_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_department_id ON public.purchase_notes USING btree (department_id);


--
-- Name: idx_pn_doc_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_doc_date ON public.purchase_notes USING btree (doc_date);


--
-- Name: idx_pn_doc_date_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_doc_date_id ON public.purchase_notes USING btree (doc_date DESC, id DESC);


--
-- Name: idx_pn_doc_number; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_doc_number ON public.purchase_notes USING btree (doc_number);


--
-- Name: idx_pn_lines_pn; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_lines_pn ON public.purchase_note_lines USING btree (purchase_note_id);


--
-- Name: idx_pn_list; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_list ON public.purchase_notes USING btree (status, doc_date DESC, id DESC);


--
-- Name: idx_pn_pay_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_pay_status ON public.purchase_notes USING btree (payment_status);


--
-- Name: idx_pn_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_status ON public.purchase_notes USING btree (status);


--
-- Name: idx_pn_status_date_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_status_date_id ON public.purchase_notes USING btree (status, doc_date DESC, id DESC);


--
-- Name: idx_pn_vendor_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_vendor_date ON public.purchase_notes_old USING btree (vendor_id, doc_date DESC);


--
-- Name: idx_pn_vendor_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_vendor_id ON public.purchase_notes USING btree (vendor_id);


--
-- Name: idx_pn_vendor_pstatus; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_vendor_pstatus ON public.purchase_notes_old USING btree (vendor_id, payment_status);


--
-- Name: idx_pn_vendor_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pn_vendor_status ON public.purchase_notes USING btree (vendor_id, status);


--
-- Name: idx_pnl_inventory_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pnl_inventory_id ON public.purchase_note_lines USING btree (inventory_id);


--
-- Name: idx_pnl_item_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pnl_item_id ON public.purchase_note_lines USING btree (item_id);


--
-- Name: idx_pnl_pn_item; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_pnl_pn_item ON public.purchase_note_lines USING btree (purchase_note_id, item_id);


--
-- Name: idx_purchase_notes_vendor_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_purchase_notes_vendor_status ON public.purchase_notes_old USING btree (vendor_id, status, doc_date);


--
-- Name: idx_rcpt_customer_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_rcpt_customer_id ON public.receipts USING btree (customer_id);


--
-- Name: idx_rcpt_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_rcpt_date ON public.receipts USING btree (date);


--
-- Name: idx_refresh_tokens_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_refresh_tokens_user ON public.refresh_tokens USING btree (user_id);


--
-- Name: idx_refresh_tokens_user_expires; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_refresh_tokens_user_expires ON public.refresh_tokens USING btree (user_id, expires_at) WHERE (used_at IS NULL);


--
-- Name: idx_role_perms_module; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_role_perms_module ON public.role_permissions USING btree (module);


--
-- Name: idx_role_perms_role; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_role_perms_role ON public.role_permissions USING btree (role_id);


--
-- Name: idx_roles_active; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_roles_active ON public.roles USING btree (is_active);


--
-- Name: idx_roles_slug; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_roles_slug ON public.roles USING btree (slug);


--
-- Name: idx_session_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_session_user ON public.session_log USING btree (user_id);


--
-- Name: idx_sys_event_outbox_created_at; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sys_event_outbox_created_at ON public.sys_event_outbox USING btree (created_at DESC);


--
-- Name: idx_trgm_acct_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trgm_acct_code ON public.accounts USING gin (code public.gin_trgm_ops);


--
-- Name: idx_trgm_acct_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trgm_acct_name ON public.accounts USING gin (name public.gin_trgm_ops);


--
-- Name: idx_trgm_cust_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trgm_cust_code ON public.customers USING gin (code public.gin_trgm_ops);


--
-- Name: idx_trgm_cust_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trgm_cust_name ON public.customers USING gin (name public.gin_trgm_ops);


--
-- Name: idx_trgm_inv_lotcode; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trgm_inv_lotcode ON public.inventory USING gin (lot_code public.gin_trgm_ops);


--
-- Name: idx_trgm_inv_lotnumber; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trgm_inv_lotnumber ON public.inventory USING gin (lot_number public.gin_trgm_ops);


--
-- Name: idx_trgm_je_number; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trgm_je_number ON public.journal_entries USING gin (je_number public.gin_trgm_ops);


--
-- Name: idx_trgm_vend_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trgm_vend_code ON public.vendors USING gin (code public.gin_trgm_ops);


--
-- Name: idx_trgm_vend_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_trgm_vend_name ON public.vendors USING gin (name public.gin_trgm_ops);


--
-- Name: idx_udw_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_udw_user ON public.user_dashboard_widgets USING btree (user_id);


--
-- Name: idx_udw_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_udw_user_id ON public.user_dashboard_widgets USING btree (user_id);


--
-- Name: idx_user_roles_role; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_roles_role ON public.user_roles USING btree (role_id);


--
-- Name: idx_user_roles_user; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_user_roles_user ON public.user_roles USING btree (user_id);


--
-- Name: idx_users_department; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_users_department ON public.users USING btree (department_id);


--
-- Name: idx_vend_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vend_name ON public.vendors USING btree (name);


--
-- Name: idx_vend_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vend_status ON public.vendors USING btree (status);


--
-- Name: idx_vendors_code_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendors_code_trgm ON public.vendors USING gin (code public.gin_trgm_ops);


--
-- Name: idx_vendors_name_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_vendors_name_trgm ON public.vendors USING gin (name public.gin_trgm_ops);


--
-- Name: refresh_tokens_token_hash_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX refresh_tokens_token_hash_key ON public.refresh_tokens USING btree (token_hash);


--
-- Name: accounts trg_accounts_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_accounts_notify AFTER INSERT OR DELETE OR UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: accounts trg_accounts_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_accounts_updated BEFORE UPDATE ON public.accounts FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: asset_templates trg_asset_templates_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_asset_templates_notify AFTER INSERT OR DELETE OR UPDATE ON public.asset_templates FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: audit_logs trg_audit_logs_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_audit_logs_notify AFTER INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: bank_deposits trg_bank_deposits_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_bank_deposits_notify AFTER INSERT OR DELETE OR UPDATE ON public.bank_deposits FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: bank_reconciliation trg_bank_reconciliation_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_bank_reconciliation_notify AFTER INSERT OR DELETE OR UPDATE ON public.bank_reconciliation FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: cost_centers trg_cost_centers_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_cost_centers_notify AFTER INSERT OR DELETE OR UPDATE ON public.cost_centers FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: customers trg_customers_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_customers_notify AFTER INSERT OR DELETE OR UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: customers trg_customers_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_customers_updated BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: departments trg_departments_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_departments_notify AFTER INSERT OR DELETE OR UPDATE ON public.departments FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: departments trg_departments_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_departments_updated BEFORE UPDATE ON public.departments FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: depreciation_runs trg_depreciation_runs_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_depreciation_runs_notify AFTER INSERT OR DELETE OR UPDATE ON public.depreciation_runs FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: expenses trg_expenses_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_expenses_notify AFTER INSERT OR DELETE OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: expenses trg_expenses_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_expenses_updated BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: fixed_assets trg_fa_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_fa_updated BEFORE UPDATE ON public.fixed_assets FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: fixed_asset_categories trg_fac_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_fac_updated BEFORE UPDATE ON public.fixed_asset_categories FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: fixed_asset_categories trg_fixed_asset_categories_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_fixed_asset_categories_notify AFTER INSERT OR DELETE OR UPDATE ON public.fixed_asset_categories FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: fixed_assets trg_fixed_assets_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_fixed_assets_notify AFTER INSERT OR DELETE OR UPDATE ON public.fixed_assets FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: inventory trg_inventory_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_inventory_notify AFTER INSERT OR DELETE OR UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: inventory trg_inventory_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_inventory_updated BEFORE UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: invoices trg_invoices_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_invoices_notify AFTER INSERT OR DELETE OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: invoices_old trg_invoices_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON public.invoices_old FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: items trg_items_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_items_notify AFTER INSERT OR DELETE OR UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: items trg_items_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_items_updated BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: je_allocations trg_je_allocations_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_je_allocations_notify AFTER INSERT OR DELETE OR UPDATE ON public.je_allocations FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: journal_entries_old trg_je_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_je_updated BEFORE UPDATE ON public.journal_entries_old FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: journal_entries trg_journal_entries_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_journal_entries_notify AFTER INSERT OR DELETE OR UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: locations trg_locations_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_locations_notify AFTER INSERT OR DELETE OR UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: locations trg_locations_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_locations_updated BEFORE UPDATE ON public.locations FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: login_attempts trg_login_attempts_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_login_attempts_notify AFTER INSERT OR DELETE OR UPDATE ON public.login_attempts FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: lot_movements trg_lot_movements_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_lot_movements_notify AFTER INSERT OR DELETE OR UPDATE ON public.lot_movements FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: machine_processes trg_machine_processes_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_machine_processes_notify AFTER INSERT OR DELETE OR UPDATE ON public.machine_processes FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: machines trg_machines_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_machines_notify AFTER INSERT OR DELETE OR UPDATE ON public.machines FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: machines trg_machines_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_machines_updated BEFORE UPDATE ON public.machines FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: payments trg_payments_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_payments_notify AFTER INSERT OR DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: payments trg_payments_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: purchase_notes_old trg_pn_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_pn_updated BEFORE UPDATE ON public.purchase_notes_old FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: process_master trg_process_master_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_process_master_notify AFTER INSERT OR DELETE OR UPDATE ON public.process_master FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: process_transactions trg_process_transactions_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_process_transactions_notify AFTER INSERT OR DELETE OR UPDATE ON public.process_transactions FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: process_transactions trg_ptrs_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_ptrs_updated BEFORE UPDATE ON public.process_transactions FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: purchase_notes trg_purchase_notes_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_purchase_notes_notify AFTER INSERT OR DELETE OR UPDATE ON public.purchase_notes FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: receipts trg_receipts_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_receipts_notify AFTER INSERT OR DELETE OR UPDATE ON public.receipts FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: receipts trg_receipts_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_receipts_updated BEFORE UPDATE ON public.receipts FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: refresh_tokens trg_refresh_tokens_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_refresh_tokens_notify AFTER INSERT OR DELETE OR UPDATE ON public.refresh_tokens FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: role_permissions trg_role_permissions_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_role_permissions_notify AFTER INSERT OR DELETE OR UPDATE ON public.role_permissions FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: rough_growth trg_rough_growth_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_rough_growth_notify AFTER INSERT OR DELETE OR UPDATE ON public.rough_growth FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: user_dashboard_widgets trg_user_dashboard_widgets_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_user_dashboard_widgets_notify AFTER INSERT OR DELETE OR UPDATE ON public.user_dashboard_widgets FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: user_permissions trg_user_permissions_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_user_permissions_notify AFTER INSERT OR DELETE OR UPDATE ON public.user_permissions FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: user_preferences trg_user_preferences_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_user_preferences_notify AFTER INSERT OR DELETE OR UPDATE ON public.user_preferences FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: user_roles trg_user_roles_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_user_roles_notify AFTER INSERT OR DELETE OR UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: users trg_users_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_users_notify AFTER INSERT OR DELETE OR UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: users trg_users_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: vendors trg_vendors_notify; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_vendors_notify AFTER INSERT OR DELETE OR UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.emit_table_change();


--
-- Name: vendors trg_vendors_updated; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_vendors_updated BEFORE UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();


--
-- Name: accounts accounts_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.accounts(id) ON DELETE SET NULL;


--
-- Name: api_logs api_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.api_logs
    ADD CONSTRAINT api_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: asset_templates asset_templates_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_templates
    ADD CONSTRAINT asset_templates_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.fixed_asset_categories(id) ON DELETE RESTRICT;


--
-- Name: asset_templates asset_templates_default_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.asset_templates
    ADD CONSTRAINT asset_templates_default_uom_id_fkey FOREIGN KEY (default_uom_id) REFERENCES public.uom(id) ON DELETE SET NULL;


--
-- Name: audit_log audit_log_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.users(id);


--
-- Name: bank_deposits bank_deposits_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bank_deposits
    ADD CONSTRAINT bank_deposits_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.accounts(id);


--
-- Name: bank_deposits bank_deposits_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.bank_deposits
    ADD CONSTRAINT bank_deposits_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: customers customers_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;


--
-- Name: depreciation_runs depreciation_runs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.depreciation_runs
    ADD CONSTRAINT depreciation_runs_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: expense_categories expense_categories_gl_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expense_categories
    ADD CONSTRAINT expense_categories_gl_account_id_fkey FOREIGN KEY (gl_account_id) REFERENCES public.accounts(id);


--
-- Name: expenses expenses_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.expense_categories(id);


--
-- Name: expenses expenses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: expenses expenses_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: expenses expenses_payment_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_payment_account_id_fkey FOREIGN KEY (payment_account_id) REFERENCES public.accounts(id);


--
-- Name: expenses expenses_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: fixed_asset_categories fixed_asset_categories_gl_accum_depr_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_asset_categories
    ADD CONSTRAINT fixed_asset_categories_gl_accum_depr_account_id_fkey FOREIGN KEY (gl_accum_depr_account_id) REFERENCES public.accounts(id);


--
-- Name: fixed_asset_categories fixed_asset_categories_gl_asset_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_asset_categories
    ADD CONSTRAINT fixed_asset_categories_gl_asset_account_id_fkey FOREIGN KEY (gl_asset_account_id) REFERENCES public.accounts(id);


--
-- Name: fixed_asset_categories fixed_asset_categories_gl_depr_expense_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_asset_categories
    ADD CONSTRAINT fixed_asset_categories_gl_depr_expense_account_id_fkey FOREIGN KEY (gl_depr_expense_account_id) REFERENCES public.accounts(id);


--
-- Name: fixed_assets fixed_assets_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_assets
    ADD CONSTRAINT fixed_assets_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.fixed_asset_categories(id);


--
-- Name: fixed_assets fixed_assets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_assets
    ADD CONSTRAINT fixed_assets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: fixed_assets fixed_assets_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_assets
    ADD CONSTRAINT fixed_assets_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;


--
-- Name: fixed_assets fixed_assets_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_assets
    ADD CONSTRAINT fixed_assets_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;


--
-- Name: fixed_assets fixed_assets_purchase_note_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_assets
    ADD CONSTRAINT fixed_assets_purchase_note_line_id_fkey FOREIGN KEY (purchase_note_line_id) REFERENCES public.purchase_note_lines(id) ON DELETE SET NULL;


--
-- Name: fixed_assets fixed_assets_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_assets
    ADD CONSTRAINT fixed_assets_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.asset_templates(id) ON DELETE SET NULL;


--
-- Name: fixed_assets fixed_assets_uom_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_assets
    ADD CONSTRAINT fixed_assets_uom_id_fkey FOREIGN KEY (uom_id) REFERENCES public.uom(id) ON DELETE SET NULL;


--
-- Name: fixed_assets fixed_assets_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.fixed_assets
    ADD CONSTRAINT fixed_assets_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id) ON DELETE SET NULL;


--
-- Name: departments fk_dept_location; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.departments
    ADD CONSTRAINT fk_dept_location FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;


--
-- Name: user_dashboard_widgets fk_udw_user_id; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_dashboard_widgets
    ADD CONSTRAINT fk_udw_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: growth_run_cycles growth_run_cycles_growth_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.growth_run_cycles
    ADD CONSTRAINT growth_run_cycles_growth_run_id_fkey FOREIGN KEY (growth_run_id) REFERENCES public.inventory(id) ON DELETE CASCADE;


--
-- Name: growth_run_cycles growth_run_cycles_machine_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.growth_run_cycles
    ADD CONSTRAINT growth_run_cycles_machine_process_id_fkey FOREIGN KEY (machine_process_id) REFERENCES public.machine_processes(id);


--
-- Name: growth_run_cycles growth_run_cycles_performed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.growth_run_cycles
    ADD CONSTRAINT growth_run_cycles_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES public.users(id);


--
-- Name: inventory inventory_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: inventory inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: inventory inventory_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id);


--
-- Name: inventory inventory_machine_process_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_machine_process_id_fkey FOREIGN KEY (machine_process_id) REFERENCES public.machine_processes(id);


--
-- Name: inventory inventory_parent_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_parent_lot_id_fkey FOREIGN KEY (parent_lot_id) REFERENCES public.inventory(id);


--
-- Name: inventory inventory_root_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_root_lot_id_fkey FOREIGN KEY (root_lot_id) REFERENCES public.inventory(id);


--
-- Name: inventory inventory_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: invoices_old invoices_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices_old
    ADD CONSTRAINT invoices_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: invoices_old invoices_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices_old
    ADD CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: items items_fixed_asset_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.items
    ADD CONSTRAINT items_fixed_asset_category_id_fkey FOREIGN KEY (fixed_asset_category_id) REFERENCES public.fixed_asset_categories(id);


--
-- Name: je_lines_old je_lines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.je_lines_old
    ADD CONSTRAINT je_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: je_lines_old je_lines_cost_center_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.je_lines_old
    ADD CONSTRAINT je_lines_cost_center_id_fkey FOREIGN KEY (cost_center_id) REFERENCES public.cost_centers(id);


--
-- Name: journal_entries_old journal_entries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.journal_entries_old
    ADD CONSTRAINT journal_entries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: journal_entries_old journal_entries_reversed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.journal_entries_old
    ADD CONSTRAINT journal_entries_reversed_by_fkey FOREIGN KEY (reversed_by) REFERENCES public.users(id);


--
-- Name: lot_movements_old lot_movements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lot_movements_old
    ADD CONSTRAINT lot_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: machine_processes machine_processes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_processes
    ADD CONSTRAINT machine_processes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: machine_processes machine_processes_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_processes
    ADD CONSTRAINT machine_processes_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id);


--
-- Name: machine_processes machine_processes_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machine_processes
    ADD CONSTRAINT machine_processes_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.users(id);


--
-- Name: machines machines_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT machines_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;


--
-- Name: machines machines_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.machines
    ADD CONSTRAINT machines_location_id_fkey FOREIGN KEY (location_id) REFERENCES public.locations(id) ON DELETE SET NULL;


--
-- Name: payments payments_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.accounts(id);


--
-- Name: payments payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: payments payments_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: pending_transfer_lots pending_transfer_lots_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pending_transfer_lots
    ADD CONSTRAINT pending_transfer_lots_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.inventory(id);


--
-- Name: pending_transfer_lots pending_transfer_lots_pending_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pending_transfer_lots
    ADD CONSTRAINT pending_transfer_lots_pending_transfer_id_fkey FOREIGN KEY (pending_transfer_id) REFERENCES public.pending_transfers(id) ON DELETE CASCADE;


--
-- Name: pending_transfers pending_transfers_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pending_transfers
    ADD CONSTRAINT pending_transfers_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id);


--
-- Name: pending_transfers pending_transfers_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pending_transfers
    ADD CONSTRAINT pending_transfers_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: pending_transfers pending_transfers_destination_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pending_transfers
    ADD CONSTRAINT pending_transfers_destination_location_id_fkey FOREIGN KEY (destination_location_id) REFERENCES public.locations(id);


--
-- Name: pending_transfers pending_transfers_source_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.pending_transfers
    ADD CONSTRAINT pending_transfers_source_location_id_fkey FOREIGN KEY (source_location_id) REFERENCES public.locations(id);


--
-- Name: permission_audit_logs permission_audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.permission_audit_logs
    ADD CONSTRAINT permission_audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: process_transactions process_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_transactions
    ADD CONSTRAINT process_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: process_transactions process_transactions_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_transactions
    ADD CONSTRAINT process_transactions_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: process_transactions process_transactions_machine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_transactions
    ADD CONSTRAINT process_transactions_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.machines(id);


--
-- Name: process_transactions process_transactions_send_ref_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.process_transactions
    ADD CONSTRAINT process_transactions_send_ref_id_fkey FOREIGN KEY (send_ref_id) REFERENCES public.process_transactions(id);


--
-- Name: purchase_note_lines purchase_note_lines_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_note_lines
    ADD CONSTRAINT purchase_note_lines_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES public.inventory(id);


--
-- Name: purchase_note_lines purchase_note_lines_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_note_lines
    ADD CONSTRAINT purchase_note_lines_item_id_fkey FOREIGN KEY (item_id) REFERENCES public.items(id);


--
-- Name: purchase_notes_old purchase_notes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_notes_old
    ADD CONSTRAINT purchase_notes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: purchase_notes_old purchase_notes_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_notes_old
    ADD CONSTRAINT purchase_notes_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id);


--
-- Name: purchase_notes_old purchase_notes_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_notes_old
    ADD CONSTRAINT purchase_notes_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendors(id);


--
-- Name: receipts receipts_bank_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.receipts
    ADD CONSTRAINT receipts_bank_account_id_fkey FOREIGN KEY (bank_account_id) REFERENCES public.accounts(id);


--
-- Name: receipts receipts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.receipts
    ADD CONSTRAINT receipts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: receipts receipts_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.receipts
    ADD CONSTRAINT receipts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: session_log session_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.session_log
    ADD CONSTRAINT session_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: stock_transfer stock_transfer_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer
    ADD CONSTRAINT stock_transfer_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: stock_transfer stock_transfer_destination_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer
    ADD CONSTRAINT stock_transfer_destination_location_id_fkey FOREIGN KEY (destination_location_id) REFERENCES public.locations(id);


--
-- Name: stock_transfer_items stock_transfer_items_lot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES public.inventory(id);


--
-- Name: stock_transfer_items stock_transfer_items_stock_transfer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer_items
    ADD CONSTRAINT stock_transfer_items_stock_transfer_id_fkey FOREIGN KEY (stock_transfer_id) REFERENCES public.stock_transfer(id) ON DELETE CASCADE;


--
-- Name: stock_transfer stock_transfer_source_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.stock_transfer
    ADD CONSTRAINT stock_transfer_source_location_id_fkey FOREIGN KEY (source_location_id) REFERENCES public.locations(id);


--
-- Name: user_roles user_roles_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: users users_department_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_department_id_fkey FOREIGN KEY (department_id) REFERENCES public.departments(id) ON DELETE SET NULL;


--
-- Name: vendors vendors_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendors
    ADD CONSTRAINT vendors_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id) ON DELETE SET NULL;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- Name: mv_dashboard_financial; Type: MATERIALIZED VIEW DATA; Schema: public; Owner: postgres
--

REFRESH MATERIALIZED VIEW public.mv_dashboard_financial;


--
-- Name: mv_trial_balance; Type: MATERIALIZED VIEW DATA; Schema: public; Owner: postgres
--

REFRESH MATERIALIZED VIEW public.mv_trial_balance;


--
-- PostgreSQL database dump complete
--

\unrestrict yGT90xFvzKwyPPQo5SaXGMcYlePwITxkKajnchbpz9cyblCAmKa0hfF9hagE3ql

