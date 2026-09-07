--
-- PostgreSQL database dump
--

\restrict hxRlSU8roGhc2bS98Dj5HP5HjP67RLqxet0B5MrHPtKWKLXFJyGynrdZP3QGH4P

-- Dumped from database version 16.15 (ef25dd3)
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: estimate_approval_decision; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.estimate_approval_decision AS ENUM (
    'approved',
    'partially_approved',
    'declined'
);


ALTER TYPE public.estimate_approval_decision OWNER TO neondb_owner;

--
-- Name: estimate_approval_item_decision; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.estimate_approval_item_decision AS ENUM (
    'approved',
    'declined'
);


ALTER TYPE public.estimate_approval_item_decision OWNER TO neondb_owner;

--
-- Name: estimate_item_kind; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.estimate_item_kind AS ENUM (
    'part',
    'labor',
    'fee',
    'discount'
);


ALTER TYPE public.estimate_item_kind OWNER TO neondb_owner;

--
-- Name: estimate_revision_kind; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.estimate_revision_kind AS ENUM (
    'estimate',
    'supplement'
);


ALTER TYPE public.estimate_revision_kind OWNER TO neondb_owner;

--
-- Name: estimate_revision_status; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.estimate_revision_status AS ENUM (
    'draft',
    'sent',
    'approved',
    'partially_approved',
    'declined',
    'superseded'
);


ALTER TYPE public.estimate_revision_status OWNER TO neondb_owner;

--
-- Name: invoice_status; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.invoice_status AS ENUM (
    'draft',
    'issued',
    'partially_paid',
    'paid',
    'void'
);


ALTER TYPE public.invoice_status OWNER TO neondb_owner;

--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.payment_status AS ENUM (
    'pending',
    'succeeded',
    'failed',
    'refunded',
    'void'
);


ALTER TYPE public.payment_status OWNER TO neondb_owner;

--
-- Name: repair_order_event_type; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.repair_order_event_type AS ENUM (
    'opened',
    'status_changed',
    'assigned',
    'estimate_created',
    'estimate_sent',
    'estimate_decided',
    'supplement_created',
    'supplement_sent',
    'supplement_decided',
    'work_authorized',
    'work_performed',
    'invoice_created',
    'invoice_issued',
    'invoice_voided',
    'payment_recorded',
    'payment_failed',
    'payment_refunded',
    'payment_voided',
    'ro_completed',
    'cancelled',
    'note_added'
);


ALTER TYPE public.repair_order_event_type OWNER TO neondb_owner;

--
-- Name: repair_order_priority; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.repair_order_priority AS ENUM (
    'low',
    'normal',
    'high',
    'urgent'
);


ALTER TYPE public.repair_order_priority OWNER TO neondb_owner;

--
-- Name: repair_order_status; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.repair_order_status AS ENUM (
    'open',
    'diagnosing',
    'awaiting_approval',
    'authorized',
    'in_progress',
    'completed',
    'cancelled'
);


ALTER TYPE public.repair_order_status OWNER TO neondb_owner;

--
-- Name: repair_order_work_item_status; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.repair_order_work_item_status AS ENUM (
    'authorized',
    'performed',
    'void'
);


ALTER TYPE public.repair_order_work_item_status OWNER TO neondb_owner;

--
-- Name: enforce_estimate_revision_transition(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.enforce_estimate_revision_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.sent_at IS NOT NULL THEN RAISE EXCEPTION 'sent estimate revisions cannot be deleted'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'sent' THEN
    IF NEW.status NOT IN ('approved','partially_approved','declined','superseded')
       OR (to_jsonb(NEW) - ARRAY['status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','updated_at']) THEN
      RAISE EXCEPTION 'only a sent estimate lifecycle transition is allowed';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status IN ('approved','partially_approved','declined','superseded') THEN
    RAISE EXCEPTION 'final estimate revision is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;


ALTER FUNCTION public.enforce_estimate_revision_transition() OWNER TO neondb_owner;

--
-- Name: enforce_invoice_transition(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.enforce_invoice_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status = 'void' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'final invoice is immutable';
  END IF;
  IF OLD.status <> 'draft' AND
     (to_jsonb(NEW) - ARRAY['amount_paid','balance','status','version','updated_at','voided_at','voided_by_id','void_reason'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['amount_paid','balance','status','version','updated_at','voided_at','voided_by_id','void_reason']) THEN
    RAISE EXCEPTION 'issued invoice commercial fields are immutable';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status IN ('issued','void')) OR
    (OLD.status = 'issued' AND NEW.status IN ('partially_paid','paid','void')) OR
    (OLD.status = 'partially_paid' AND NEW.status IN ('issued','paid','void')) OR
    (OLD.status = 'paid' AND NEW.status IN ('issued','partially_paid'))
  ) THEN RAISE EXCEPTION 'invalid invoice status transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.enforce_invoice_transition() OWNER TO neondb_owner;

--
-- Name: enforce_payment_transition(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.enforce_payment_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payments cannot be deleted'; END IF;
  IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'final payment entries are immutable'; END IF;
  IF NEW.status NOT IN ('succeeded','failed','void')
     OR (to_jsonb(NEW) - ARRAY['status','processor','processor_payment_id','processor_event_id','failure_reason','voided_at','processed_at'])
       IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['status','processor','processor_payment_id','processor_event_id','failure_reason','voided_at','processed_at']) THEN
    RAISE EXCEPTION 'only a pending payment result transition is allowed';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.enforce_payment_transition() OWNER TO neondb_owner;

--
-- Name: enforce_repair_order_transition(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.enforce_repair_order_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status IN ('completed','cancelled') THEN
    IF NEW.status <> OLD.status OR
       (to_jsonb(NEW) - ARRAY['notes','updated_at','version']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['notes','updated_at','version']) THEN
      RAISE EXCEPTION 'terminal repair order is immutable';
    END IF;
  ELSIF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'open' AND NEW.status IN ('diagnosing','awaiting_approval','authorized','cancelled')) OR
    (OLD.status = 'diagnosing' AND NEW.status IN ('awaiting_approval','authorized','cancelled')) OR
    (OLD.status = 'awaiting_approval' AND NEW.status IN ('authorized','in_progress','diagnosing','cancelled')) OR
    (OLD.status = 'authorized' AND NEW.status IN ('in_progress','awaiting_approval','cancelled')) OR
    (OLD.status = 'in_progress' AND NEW.status IN ('completed','authorized','awaiting_approval','cancelled'))
  ) THEN RAISE EXCEPTION 'invalid repair order status transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.enforce_repair_order_transition() OWNER TO neondb_owner;

--
-- Name: reject_repair_domain_mutation(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.reject_repair_domain_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION '% is immutable', TG_TABLE_NAME; END $$;


ALTER FUNCTION public.reject_repair_domain_mutation() OWNER TO neondb_owner;

--
-- Name: reject_sent_estimate_item_mutation(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.reject_sent_estimate_item_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM estimate_revisions WHERE id = OLD.estimate_revision_id AND sent_at IS NOT NULL) THEN
    RAISE EXCEPTION 'items on sent estimate revisions are immutable';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.reject_sent_estimate_item_mutation() OWNER TO neondb_owner;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_events; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.activity_events (
    id integer NOT NULL,
    entity_type text NOT NULL,
    entity_id integer NOT NULL,
    event_type text NOT NULL,
    actor_id integer,
    actor_label text,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.activity_events OWNER TO neondb_owner;

--
-- Name: activity_events_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.activity_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.activity_events_id_seq OWNER TO neondb_owner;

--
-- Name: activity_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.activity_events_id_seq OWNED BY public.activity_events.id;


--
-- Name: appointments; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.appointments (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    vehicle_id integer,
    assigned_to_id integer,
    status text DEFAULT 'scheduled'::text NOT NULL,
    service_type text NOT NULL,
    description text,
    scheduled_at timestamp without time zone NOT NULL,
    estimated_duration integer,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.appointments OWNER TO neondb_owner;

--
-- Name: appointments_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.appointments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.appointments_id_seq OWNER TO neondb_owner;

--
-- Name: appointments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.appointments_id_seq OWNED BY public.appointments.id;


--
-- Name: attachments; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.attachments (
    id integer NOT NULL,
    owner_type text NOT NULL,
    owner_id integer NOT NULL,
    file_name text NOT NULL,
    mime_type text NOT NULL,
    size integer NOT NULL,
    storage_path text NOT NULL,
    notes text,
    uploaded_by_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.attachments OWNER TO neondb_owner;

--
-- Name: attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.attachments_id_seq OWNER TO neondb_owner;

--
-- Name: attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.attachments_id_seq OWNED BY public.attachments.id;


--
-- Name: canned_jobs; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.canned_jobs (
    id integer NOT NULL,
    name text NOT NULL,
    category text,
    description text,
    estimated_hours numeric(10,2),
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.canned_jobs OWNER TO neondb_owner;

--
-- Name: canned_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.canned_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.canned_jobs_id_seq OWNER TO neondb_owner;

--
-- Name: canned_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.canned_jobs_id_seq OWNED BY public.canned_jobs.id;


--
-- Name: customer_categories; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.customer_categories (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    labor_rate numeric(10,2) DEFAULT '120'::numeric NOT NULL,
    parts_markup numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.customer_categories OWNER TO neondb_owner;

--
-- Name: customer_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.customer_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customer_categories_id_seq OWNER TO neondb_owner;

--
-- Name: customer_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.customer_categories_id_seq OWNED BY public.customer_categories.id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text,
    phone text,
    address text,
    city text,
    state text,
    zip text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    category_id integer,
    preferred_channel text DEFAULT 'email'::text NOT NULL,
    sms_opt_out text DEFAULT 'false'::text NOT NULL,
    tax_exempt boolean DEFAULT false NOT NULL,
    tax_exempt_number text,
    square_customer_id text
);


ALTER TABLE public.customers OWNER TO neondb_owner;

--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customers_id_seq OWNER TO neondb_owner;

--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.email_templates (
    id integer NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    subject text NOT NULL,
    body_html text NOT NULL,
    from_name text,
    from_email text,
    enabled text DEFAULT 'true'::text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.email_templates OWNER TO neondb_owner;

--
-- Name: email_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.email_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.email_templates_id_seq OWNER TO neondb_owner;

--
-- Name: email_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.email_templates_id_seq OWNED BY public.email_templates.id;


--
-- Name: employees; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.employees (
    id integer NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text,
    phone text,
    role text DEFAULT 'technician'::text NOT NULL,
    hourly_rate numeric(10,2),
    active boolean DEFAULT true NOT NULL,
    hire_date date,
    notes text,
    clocked_in boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    roles text[] DEFAULT ARRAY[]::text[] NOT NULL,
    username text,
    password_hash text,
    last_login_at timestamp without time zone
);


ALTER TABLE public.employees OWNER TO neondb_owner;

--
-- Name: employees_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.employees_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.employees_id_seq OWNER TO neondb_owner;

--
-- Name: employees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.employees_id_seq OWNED BY public.employees.id;


--
-- Name: estimate_approval_items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.estimate_approval_items (
    id integer NOT NULL,
    approval_id integer NOT NULL,
    estimate_item_id integer NOT NULL,
    decision public.estimate_approval_item_decision NOT NULL
);


ALTER TABLE public.estimate_approval_items OWNER TO neondb_owner;

--
-- Name: estimate_approval_items_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.estimate_approval_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.estimate_approval_items_id_seq OWNER TO neondb_owner;

--
-- Name: estimate_approval_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.estimate_approval_items_id_seq OWNED BY public.estimate_approval_items.id;


--
-- Name: estimate_approvals; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.estimate_approvals (
    id integer NOT NULL,
    estimate_revision_id integer NOT NULL,
    decision public.estimate_approval_decision NOT NULL,
    signer_name text,
    signer_email text,
    signature_url text,
    document_hash text NOT NULL,
    request_ip text,
    request_user_agent text,
    decided_at timestamp with time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.estimate_approvals OWNER TO neondb_owner;

--
-- Name: estimate_approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.estimate_approvals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.estimate_approvals_id_seq OWNER TO neondb_owner;

--
-- Name: estimate_approvals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.estimate_approvals_id_seq OWNED BY public.estimate_approvals.id;


--
-- Name: estimate_items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.estimate_items (
    id integer NOT NULL,
    estimate_revision_id integer NOT NULL,
    "position" integer NOT NULL,
    kind public.estimate_item_kind NOT NULL,
    description text NOT NULL,
    quantity numeric(14,3) DEFAULT 1 NOT NULL,
    unit_price numeric(14,2) DEFAULT 0 NOT NULL,
    unit_cost numeric(14,2),
    inventory_item_id integer,
    estimated_hours numeric(10,2),
    warranty_months integer,
    warranty_miles integer,
    CONSTRAINT estimate_items_check CHECK (((unit_price >= (0)::numeric) AND ((unit_cost IS NULL) OR (unit_cost >= (0)::numeric)) AND ((estimated_hours IS NULL) OR (estimated_hours >= (0)::numeric)))),
    CONSTRAINT estimate_items_check1 CHECK ((((warranty_months IS NULL) OR (warranty_months >= 0)) AND ((warranty_miles IS NULL) OR (warranty_miles >= 0)))),
    CONSTRAINT estimate_items_position_check CHECK (("position" > 0)),
    CONSTRAINT estimate_items_quantity_check CHECK ((quantity > (0)::numeric))
);


ALTER TABLE public.estimate_items OWNER TO neondb_owner;

--
-- Name: estimate_items_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.estimate_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.estimate_items_id_seq OWNER TO neondb_owner;

--
-- Name: estimate_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.estimate_items_id_seq OWNED BY public.estimate_items.id;


--
-- Name: estimate_revisions; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.estimate_revisions (
    id integer NOT NULL,
    repair_order_id integer NOT NULL,
    revision_no integer NOT NULL,
    kind public.estimate_revision_kind DEFAULT 'estimate'::public.estimate_revision_kind NOT NULL,
    status public.estimate_revision_status DEFAULT 'draft'::public.estimate_revision_status NOT NULL,
    notes text,
    customer_snapshot jsonb NOT NULL,
    vehicle_snapshot jsonb NOT NULL,
    subtotal numeric(14,2) DEFAULT 0 NOT NULL,
    tax_rate_bps integer DEFAULT 0 NOT NULL,
    tax_amount numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) DEFAULT 0 NOT NULL,
    public_token text,
    sent_at timestamp with time zone,
    created_by_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estimate_revisions_check CHECK (((subtotal >= (0)::numeric) AND (tax_amount >= (0)::numeric) AND (total >= (0)::numeric) AND ((tax_rate_bps >= 0) AND (tax_rate_bps <= 10000)))),
    CONSTRAINT estimate_revisions_revision_no_check CHECK ((revision_no > 0))
);


ALTER TABLE public.estimate_revisions OWNER TO neondb_owner;

--
-- Name: estimate_revisions_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.estimate_revisions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.estimate_revisions_id_seq OWNER TO neondb_owner;

--
-- Name: estimate_revisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.estimate_revisions_id_seq OWNED BY public.estimate_revisions.id;


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.expenses (
    id integer NOT NULL,
    category text NOT NULL,
    description text NOT NULL,
    amount numeric(10,2) NOT NULL,
    vendor text,
    receipt_number text,
    expense_date date NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.expenses OWNER TO neondb_owner;

--
-- Name: expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.expenses_id_seq OWNER TO neondb_owner;

--
-- Name: expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.expenses_id_seq OWNED BY public.expenses.id;


--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.idempotency_keys (
    id integer NOT NULL,
    scope text NOT NULL,
    key text NOT NULL,
    request_hash text NOT NULL,
    response_status integer,
    response_body jsonb,
    completed_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.idempotency_keys OWNER TO neondb_owner;

--
-- Name: idempotency_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.idempotency_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.idempotency_keys_id_seq OWNER TO neondb_owner;

--
-- Name: idempotency_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.idempotency_keys_id_seq OWNED BY public.idempotency_keys.id;


--
-- Name: inspections; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.inspections (
    id integer NOT NULL,
    vehicle_id integer NOT NULL,
    repair_order_id integer,
    inspected_by_id integer,
    type text NOT NULL,
    mileage integer,
    overall_condition text DEFAULT 'good'::text NOT NULL,
    items jsonb DEFAULT '[]'::jsonb,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    public_token text,
    sent_at timestamp with time zone,
    customer_signature_url text,
    customer_signed_at timestamp with time zone,
    customer_signer_name text,
    customer_ip text
);


ALTER TABLE public.inspections OWNER TO neondb_owner;

--
-- Name: inspections_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.inspections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.inspections_id_seq OWNER TO neondb_owner;

--
-- Name: inspections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.inspections_id_seq OWNED BY public.inspections.id;


--
-- Name: inventory; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.inventory (
    id integer NOT NULL,
    part_number text,
    name text NOT NULL,
    description text,
    category text NOT NULL,
    vendor text,
    cost_price numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    sell_price numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    quantity integer DEFAULT 0 NOT NULL,
    min_quantity integer DEFAULT 0 NOT NULL,
    location text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    compatible_vehicles text,
    preferred_supplier_id integer,
    default_warranty_months integer,
    default_warranty_miles integer,
    square_catalog_object_id text,
    square_location_id text
);


ALTER TABLE public.inventory OWNER TO neondb_owner;

--
-- Name: inventory_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.inventory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.inventory_id_seq OWNER TO neondb_owner;

--
-- Name: inventory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.inventory_id_seq OWNED BY public.inventory.id;


--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.invoice_items (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    source_work_item_id integer NOT NULL,
    "position" integer NOT NULL,
    kind public.estimate_item_kind NOT NULL,
    description text NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit_price numeric(14,2) NOT NULL,
    unit_cost numeric(14,2),
    line_total numeric(14,2) NOT NULL,
    CONSTRAINT invoice_items_check CHECK (((quantity > (0)::numeric) AND (unit_price >= (0)::numeric) AND ((unit_cost IS NULL) OR (unit_cost >= (0)::numeric)))),
    CONSTRAINT invoice_items_position_check CHECK (("position" > 0))
);


ALTER TABLE public.invoice_items OWNER TO neondb_owner;

--
-- Name: invoice_items_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.invoice_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoice_items_id_seq OWNER TO neondb_owner;

--
-- Name: invoice_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.invoice_items_id_seq OWNED BY public.invoice_items.id;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.invoices (
    id integer NOT NULL,
    invoice_number text NOT NULL,
    repair_order_id integer NOT NULL,
    customer_snapshot jsonb NOT NULL,
    vehicle_snapshot jsonb NOT NULL,
    status public.invoice_status DEFAULT 'draft'::public.invoice_status NOT NULL,
    notes text,
    subtotal numeric(14,2) DEFAULT 0 NOT NULL,
    tax_rate_bps integer DEFAULT 0 NOT NULL,
    tax_amount numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) DEFAULT 0 NOT NULL,
    amount_paid numeric(14,2) DEFAULT 0 NOT NULL,
    balance numeric(14,2) DEFAULT 0 NOT NULL,
    tax_exempt boolean DEFAULT false NOT NULL,
    tax_exempt_number text,
    public_token text,
    issued_at timestamp with time zone,
    issued_by_id integer,
    voided_at timestamp with time zone,
    voided_by_id integer,
    void_reason text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoices_check CHECK (((subtotal >= (0)::numeric) AND (tax_amount >= (0)::numeric) AND (total >= (0)::numeric) AND (amount_paid >= (0)::numeric) AND (balance >= (0)::numeric) AND ((tax_rate_bps >= 0) AND (tax_rate_bps <= 10000)))),
    CONSTRAINT invoices_check1 CHECK (((status <> 'void'::public.invoice_status) OR ((voided_at IS NOT NULL) AND (void_reason IS NOT NULL)))),
    CONSTRAINT invoices_version_check CHECK ((version > 0))
);


ALTER TABLE public.invoices OWNER TO neondb_owner;

--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoices_id_seq OWNER TO neondb_owner;

--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.messages (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    repair_order_id integer,
    estimate_id integer,
    invoice_id integer,
    direction text NOT NULL,
    channel text DEFAULT 'sms'::text NOT NULL,
    from_number text,
    to_number text,
    body text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    failure_reason text,
    twilio_sid text,
    read_at timestamp with time zone,
    sent_by_user_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.messages OWNER TO neondb_owner;

--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.messages_id_seq OWNER TO neondb_owner;

--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- Name: njmvc_categories; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.njmvc_categories (
    id integer NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.njmvc_categories OWNER TO neondb_owner;

--
-- Name: njmvc_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.njmvc_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.njmvc_categories_id_seq OWNER TO neondb_owner;

--
-- Name: njmvc_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.njmvc_categories_id_seq OWNED BY public.njmvc_categories.id;


--
-- Name: njmvc_inspection_results; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.njmvc_inspection_results (
    id integer NOT NULL,
    inspection_id integer NOT NULL,
    item_id integer NOT NULL,
    status text,
    repaired_date date,
    measurement_value text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.njmvc_inspection_results OWNER TO neondb_owner;

--
-- Name: njmvc_inspection_results_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.njmvc_inspection_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.njmvc_inspection_results_id_seq OWNER TO neondb_owner;

--
-- Name: njmvc_inspection_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.njmvc_inspection_results_id_seq OWNED BY public.njmvc_inspection_results.id;


--
-- Name: njmvc_inspections; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.njmvc_inspections (
    id integer NOT NULL,
    vehicle_id integer NOT NULL,
    operator_name text,
    address text,
    mechanic_name_print text,
    mechanic_name_signed text,
    report_number text,
    fleet_unit_number text,
    mileage integer,
    vehicle_type text,
    vin text,
    license_plate text,
    inspection_date date,
    certified_passed boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    purchase_date date
);


ALTER TABLE public.njmvc_inspections OWNER TO neondb_owner;

--
-- Name: njmvc_inspections_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.njmvc_inspections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.njmvc_inspections_id_seq OWNER TO neondb_owner;

--
-- Name: njmvc_inspections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.njmvc_inspections_id_seq OWNED BY public.njmvc_inspections.id;


--
-- Name: njmvc_items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.njmvc_items (
    id integer NOT NULL,
    category_id integer NOT NULL,
    label text NOT NULL,
    has_measurement boolean DEFAULT false NOT NULL,
    measurement_unit text,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    measurement_position text
);


ALTER TABLE public.njmvc_items OWNER TO neondb_owner;

--
-- Name: njmvc_items_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.njmvc_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.njmvc_items_id_seq OWNER TO neondb_owner;

--
-- Name: njmvc_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.njmvc_items_id_seq OWNED BY public.njmvc_items.id;


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.password_reset_tokens (
    id integer NOT NULL,
    employee_id integer NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.password_reset_tokens OWNER TO neondb_owner;

--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.password_reset_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.password_reset_tokens_id_seq OWNER TO neondb_owner;

--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.password_reset_tokens_id_seq OWNED BY public.password_reset_tokens.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    amount numeric(14,2) NOT NULL,
    status public.payment_status DEFAULT 'pending'::public.payment_status NOT NULL,
    method text NOT NULL,
    processor text,
    processor_payment_id text,
    processor_event_id text,
    attempt_key text NOT NULL,
    idempotency_key text,
    parent_payment_id integer,
    reference_number text,
    failure_reason text,
    refunded_at timestamp with time zone,
    voided_at timestamp with time zone,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payments_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT payments_check CHECK ((((status = 'refunded'::public.payment_status) AND (parent_payment_id IS NOT NULL)) OR (parent_payment_id IS NULL) OR (status = 'void'::public.payment_status)))
);


ALTER TABLE public.payments OWNER TO neondb_owner;

--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.payments_id_seq OWNER TO neondb_owner;

--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: processor_webhook_receipts; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.processor_webhook_receipts (
    id integer NOT NULL,
    processor text NOT NULL,
    event_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    failure_reason text
);


ALTER TABLE public.processor_webhook_receipts OWNER TO neondb_owner;

--
-- Name: processor_webhook_receipts_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.processor_webhook_receipts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.processor_webhook_receipts_id_seq OWNER TO neondb_owner;

--
-- Name: processor_webhook_receipts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.processor_webhook_receipts_id_seq OWNED BY public.processor_webhook_receipts.id;


--
-- Name: purchase_line_items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.purchase_line_items (
    id integer NOT NULL,
    purchase_id integer NOT NULL,
    item_type text NOT NULL,
    inventory_id integer,
    used_car_id integer,
    description text NOT NULL,
    quantity numeric(10,2) DEFAULT '1'::numeric NOT NULL,
    unit_cost numeric(10,2) NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.purchase_line_items OWNER TO neondb_owner;

--
-- Name: purchase_line_items_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.purchase_line_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.purchase_line_items_id_seq OWNER TO neondb_owner;

--
-- Name: purchase_line_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.purchase_line_items_id_seq OWNED BY public.purchase_line_items.id;


--
-- Name: purchases; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.purchases (
    id integer NOT NULL,
    supplier_legacy text,
    supplier_contact text,
    supplier_email text,
    supplier_phone text,
    invoice_number text,
    amount numeric(10,2) NOT NULL,
    tax numeric(10,2) DEFAULT '0'::numeric,
    shipping numeric(10,2) DEFAULT '0'::numeric,
    status text DEFAULT 'pending'::text NOT NULL,
    purchase_date date NOT NULL,
    notes text,
    invoice_file_path text,
    invoice_file_name text,
    invoice_file_type text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    supplier_id integer
);


ALTER TABLE public.purchases OWNER TO neondb_owner;

--
-- Name: purchases_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.purchases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.purchases_id_seq OWNER TO neondb_owner;

--
-- Name: purchases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.purchases_id_seq OWNED BY public.purchases.id;


--
-- Name: reminders; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.reminders (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    vehicle_id integer,
    service_type text NOT NULL,
    due_date date NOT NULL,
    due_mileage integer,
    sent boolean DEFAULT false NOT NULL,
    sent_at timestamp without time zone,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.reminders OWNER TO neondb_owner;

--
-- Name: reminders_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.reminders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.reminders_id_seq OWNER TO neondb_owner;

--
-- Name: reminders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.reminders_id_seq OWNED BY public.reminders.id;


--
-- Name: repair_order_events; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.repair_order_events (
    id integer NOT NULL,
    repair_order_id integer NOT NULL,
    event_type public.repair_order_event_type NOT NULL,
    actor_id integer,
    actor_label text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.repair_order_events OWNER TO neondb_owner;

--
-- Name: repair_order_events_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.repair_order_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.repair_order_events_id_seq OWNER TO neondb_owner;

--
-- Name: repair_order_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.repair_order_events_id_seq OWNED BY public.repair_order_events.id;


--
-- Name: repair_order_work_items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.repair_order_work_items (
    id integer NOT NULL,
    repair_order_id integer NOT NULL,
    source_estimate_item_id integer NOT NULL,
    "position" integer NOT NULL,
    kind public.estimate_item_kind NOT NULL,
    description text NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit_price numeric(14,2) NOT NULL,
    unit_cost numeric(14,2),
    estimated_hours numeric(10,2),
    status public.repair_order_work_item_status DEFAULT 'authorized'::public.repair_order_work_item_status NOT NULL,
    authorized_at timestamp with time zone DEFAULT now() NOT NULL,
    performed_at timestamp with time zone,
    performed_by_id integer,
    voided_at timestamp with time zone,
    void_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT repair_order_work_items_check CHECK (((quantity > (0)::numeric) AND (unit_price >= (0)::numeric) AND ((unit_cost IS NULL) OR (unit_cost >= (0)::numeric)) AND ((estimated_hours IS NULL) OR (estimated_hours >= (0)::numeric)))),
    CONSTRAINT repair_order_work_items_position_check CHECK (("position" > 0))
);


ALTER TABLE public.repair_order_work_items OWNER TO neondb_owner;

--
-- Name: repair_order_work_items_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.repair_order_work_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.repair_order_work_items_id_seq OWNER TO neondb_owner;

--
-- Name: repair_order_work_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.repair_order_work_items_id_seq OWNED BY public.repair_order_work_items.id;


--
-- Name: repair_orders; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.repair_orders (
    id integer NOT NULL,
    order_number text NOT NULL,
    customer_id integer NOT NULL,
    vehicle_id integer NOT NULL,
    used_car_id integer,
    internal boolean DEFAULT false NOT NULL,
    assigned_to_id integer,
    created_by_id integer NOT NULL,
    status public.repair_order_status DEFAULT 'open'::public.repair_order_status NOT NULL,
    priority public.repair_order_priority DEFAULT 'normal'::public.repair_order_priority NOT NULL,
    complaint text,
    diagnosis text,
    notes text,
    mileage_in integer,
    mileage_out integer,
    promised_at timestamp with time zone,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT repair_orders_check CHECK (((mileage_out IS NULL) OR (mileage_in IS NULL) OR (mileage_out >= mileage_in))),
    CONSTRAINT repair_orders_check1 CHECK ((((status <> 'completed'::public.repair_order_status) OR (completed_at IS NOT NULL)) AND ((status <> 'cancelled'::public.repair_order_status) OR ((cancelled_at IS NOT NULL) AND (cancellation_reason IS NOT NULL))))),
    CONSTRAINT repair_orders_version_check CHECK ((version > 0))
);


ALTER TABLE public.repair_orders OWNER TO neondb_owner;

--
-- Name: repair_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.repair_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.repair_orders_id_seq OWNER TO neondb_owner;

--
-- Name: repair_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.repair_orders_id_seq OWNED BY public.repair_orders.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.role_permissions (
    id integer NOT NULL,
    role text NOT NULL,
    resource text NOT NULL,
    action text NOT NULL
);


ALTER TABLE public.role_permissions OWNER TO neondb_owner;

--
-- Name: role_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.role_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.role_permissions_id_seq OWNER TO neondb_owner;

--
-- Name: role_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.role_permissions_id_seq OWNED BY public.role_permissions.id;


--
-- Name: shop_settings; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.shop_settings (
    id integer NOT NULL,
    labor_rate numeric(10,2) DEFAULT 95 NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    stripe_publishable_key text,
    stripe_secret_key text,
    stripe_webhook_secret text,
    stripe_ach_enabled boolean DEFAULT false NOT NULL,
    twilio_account_sid text,
    twilio_auth_token text,
    twilio_from_number text
);


ALTER TABLE public.shop_settings OWNER TO neondb_owner;

--
-- Name: shop_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.shop_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.shop_settings_id_seq OWNER TO neondb_owner;

--
-- Name: shop_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.shop_settings_id_seq OWNED BY public.shop_settings.id;


--
-- Name: square_mappings; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.square_mappings (
    id integer NOT NULL,
    entity_type text NOT NULL,
    local_id integer NOT NULL,
    square_id text NOT NULL,
    square_version integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.square_mappings OWNER TO neondb_owner;

--
-- Name: square_mappings_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.square_mappings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.square_mappings_id_seq OWNER TO neondb_owner;

--
-- Name: square_mappings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.square_mappings_id_seq OWNED BY public.square_mappings.id;


--
-- Name: square_sync_states; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.square_sync_states (
    id integer NOT NULL,
    resource text NOT NULL,
    cursor text,
    last_synced_at timestamp with time zone,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.square_sync_states OWNER TO neondb_owner;

--
-- Name: square_sync_states_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.square_sync_states_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.square_sync_states_id_seq OWNER TO neondb_owner;

--
-- Name: square_sync_states_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.square_sync_states_id_seq OWNED BY public.square_sync_states.id;


--
-- Name: square_webhook_events; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.square_webhook_events (
    id integer NOT NULL,
    square_event_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    processed_at timestamp with time zone,
    failure_reason text,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.square_webhook_events OWNER TO neondb_owner;

--
-- Name: square_webhook_events_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.square_webhook_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.square_webhook_events_id_seq OWNER TO neondb_owner;

--
-- Name: square_webhook_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.square_webhook_events_id_seq OWNED BY public.square_webhook_events.id;


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.stock_movements (
    id integer NOT NULL,
    inventory_id integer NOT NULL,
    delta integer NOT NULL,
    reason text NOT NULL,
    reference_table text,
    reference_id integer,
    reference_line_id integer,
    unit_cost numeric(10,2),
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_id integer,
    work_item_id integer
);


ALTER TABLE public.stock_movements OWNER TO neondb_owner;

--
-- Name: stock_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.stock_movements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_movements_id_seq OWNER TO neondb_owner;

--
-- Name: stock_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.stock_movements_id_seq OWNED BY public.stock_movements.id;


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.suppliers (
    id integer NOT NULL,
    name text NOT NULL,
    account_number text,
    payment_terms text,
    contact_name text,
    contact_email text,
    contact_phone text,
    address text,
    notes text,
    archived boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.suppliers OWNER TO neondb_owner;

--
-- Name: suppliers_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.suppliers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.suppliers_id_seq OWNER TO neondb_owner;

--
-- Name: suppliers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.suppliers_id_seq OWNED BY public.suppliers.id;


--
-- Name: time_entries; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.time_entries (
    id integer NOT NULL,
    employee_id integer NOT NULL,
    repair_order_id integer,
    work_item_id integer,
    clock_in timestamp with time zone NOT NULL,
    clock_out timestamp with time zone,
    total_hours numeric(10,2),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.time_entries OWNER TO neondb_owner;

--
-- Name: time_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.time_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.time_entries_id_seq OWNER TO neondb_owner;

--
-- Name: time_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.time_entries_id_seq OWNED BY public.time_entries.id;


--
-- Name: used_cars; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.used_cars (
    id integer NOT NULL,
    vin text,
    year integer NOT NULL,
    make text NOT NULL,
    model text NOT NULL,
    "trim" text,
    color text,
    mileage integer,
    condition text,
    purchase_price numeric(10,2) NOT NULL,
    selling_price numeric(10,2),
    status text DEFAULT 'needs_work'::text NOT NULL,
    customer_id integer,
    purchase_date date,
    sale_date date,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    engine_type text,
    transmission_type text,
    buyer_id integer,
    sale_invoice_id integer,
    published boolean DEFAULT false NOT NULL
);


ALTER TABLE public.used_cars OWNER TO neondb_owner;

--
-- Name: used_cars_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.used_cars_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.used_cars_id_seq OWNER TO neondb_owner;

--
-- Name: used_cars_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.used_cars_id_seq OWNED BY public.used_cars.id;


--
-- Name: user_board_preferences; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.user_board_preferences (
    id integer NOT NULL,
    user_id integer NOT NULL,
    board_key text NOT NULL,
    column_order text[] DEFAULT '{}'::text[] NOT NULL,
    hidden_columns text[] DEFAULT '{}'::text[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_board_preferences OWNER TO neondb_owner;

--
-- Name: user_board_preferences_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.user_board_preferences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_board_preferences_id_seq OWNER TO neondb_owner;

--
-- Name: user_board_preferences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.user_board_preferences_id_seq OWNED BY public.user_board_preferences.id;


--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.vehicles (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    vin text,
    license_plate text,
    year integer NOT NULL,
    make text NOT NULL,
    model text NOT NULL,
    "trim" text,
    color text,
    mileage integer,
    engine_type text,
    transmission_type text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    fleet_number text
);


ALTER TABLE public.vehicles OWNER TO neondb_owner;

--
-- Name: vehicles_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.vehicles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vehicles_id_seq OWNER TO neondb_owner;

--
-- Name: vehicles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.vehicles_id_seq OWNED BY public.vehicles.id;


--
-- Name: activity_events id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.activity_events ALTER COLUMN id SET DEFAULT nextval('public.activity_events_id_seq'::regclass);


--
-- Name: appointments id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.appointments ALTER COLUMN id SET DEFAULT nextval('public.appointments_id_seq'::regclass);


--
-- Name: attachments id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.attachments ALTER COLUMN id SET DEFAULT nextval('public.attachments_id_seq'::regclass);


--
-- Name: canned_jobs id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.canned_jobs ALTER COLUMN id SET DEFAULT nextval('public.canned_jobs_id_seq'::regclass);


--
-- Name: customer_categories id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.customer_categories ALTER COLUMN id SET DEFAULT nextval('public.customer_categories_id_seq'::regclass);


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: email_templates id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.email_templates ALTER COLUMN id SET DEFAULT nextval('public.email_templates_id_seq'::regclass);


--
-- Name: employees id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.employees ALTER COLUMN id SET DEFAULT nextval('public.employees_id_seq'::regclass);


--
-- Name: estimate_approval_items id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approval_items ALTER COLUMN id SET DEFAULT nextval('public.estimate_approval_items_id_seq'::regclass);


--
-- Name: estimate_approvals id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approvals ALTER COLUMN id SET DEFAULT nextval('public.estimate_approvals_id_seq'::regclass);


--
-- Name: estimate_items id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_items ALTER COLUMN id SET DEFAULT nextval('public.estimate_items_id_seq'::regclass);


--
-- Name: estimate_revisions id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_revisions ALTER COLUMN id SET DEFAULT nextval('public.estimate_revisions_id_seq'::regclass);


--
-- Name: expenses id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.expenses ALTER COLUMN id SET DEFAULT nextval('public.expenses_id_seq'::regclass);


--
-- Name: idempotency_keys id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.idempotency_keys ALTER COLUMN id SET DEFAULT nextval('public.idempotency_keys_id_seq'::regclass);


--
-- Name: inspections id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inspections ALTER COLUMN id SET DEFAULT nextval('public.inspections_id_seq'::regclass);


--
-- Name: inventory id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inventory ALTER COLUMN id SET DEFAULT nextval('public.inventory_id_seq'::regclass);


--
-- Name: invoice_items id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoice_items ALTER COLUMN id SET DEFAULT nextval('public.invoice_items_id_seq'::regclass);


--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- Name: njmvc_categories id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_categories ALTER COLUMN id SET DEFAULT nextval('public.njmvc_categories_id_seq'::regclass);


--
-- Name: njmvc_inspection_results id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_inspection_results ALTER COLUMN id SET DEFAULT nextval('public.njmvc_inspection_results_id_seq'::regclass);


--
-- Name: njmvc_inspections id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_inspections ALTER COLUMN id SET DEFAULT nextval('public.njmvc_inspections_id_seq'::regclass);


--
-- Name: njmvc_items id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_items ALTER COLUMN id SET DEFAULT nextval('public.njmvc_items_id_seq'::regclass);


--
-- Name: password_reset_tokens id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.password_reset_tokens ALTER COLUMN id SET DEFAULT nextval('public.password_reset_tokens_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: processor_webhook_receipts id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.processor_webhook_receipts ALTER COLUMN id SET DEFAULT nextval('public.processor_webhook_receipts_id_seq'::regclass);


--
-- Name: purchase_line_items id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchase_line_items ALTER COLUMN id SET DEFAULT nextval('public.purchase_line_items_id_seq'::regclass);


--
-- Name: purchases id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchases ALTER COLUMN id SET DEFAULT nextval('public.purchases_id_seq'::regclass);


--
-- Name: reminders id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.reminders ALTER COLUMN id SET DEFAULT nextval('public.reminders_id_seq'::regclass);


--
-- Name: repair_order_events id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_events ALTER COLUMN id SET DEFAULT nextval('public.repair_order_events_id_seq'::regclass);


--
-- Name: repair_order_work_items id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_work_items ALTER COLUMN id SET DEFAULT nextval('public.repair_order_work_items_id_seq'::regclass);


--
-- Name: repair_orders id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders ALTER COLUMN id SET DEFAULT nextval('public.repair_orders_id_seq'::regclass);


--
-- Name: role_permissions id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.role_permissions ALTER COLUMN id SET DEFAULT nextval('public.role_permissions_id_seq'::regclass);


--
-- Name: shop_settings id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.shop_settings ALTER COLUMN id SET DEFAULT nextval('public.shop_settings_id_seq'::regclass);


--
-- Name: square_mappings id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_mappings ALTER COLUMN id SET DEFAULT nextval('public.square_mappings_id_seq'::regclass);


--
-- Name: square_sync_states id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_sync_states ALTER COLUMN id SET DEFAULT nextval('public.square_sync_states_id_seq'::regclass);


--
-- Name: square_webhook_events id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_webhook_events ALTER COLUMN id SET DEFAULT nextval('public.square_webhook_events_id_seq'::regclass);


--
-- Name: stock_movements id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.stock_movements ALTER COLUMN id SET DEFAULT nextval('public.stock_movements_id_seq'::regclass);


--
-- Name: suppliers id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.suppliers ALTER COLUMN id SET DEFAULT nextval('public.suppliers_id_seq'::regclass);


--
-- Name: time_entries id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.time_entries ALTER COLUMN id SET DEFAULT nextval('public.time_entries_id_seq'::regclass);


--
-- Name: used_cars id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.used_cars ALTER COLUMN id SET DEFAULT nextval('public.used_cars_id_seq'::regclass);


--
-- Name: user_board_preferences id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.user_board_preferences ALTER COLUMN id SET DEFAULT nextval('public.user_board_preferences_id_seq'::regclass);


--
-- Name: vehicles id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.vehicles ALTER COLUMN id SET DEFAULT nextval('public.vehicles_id_seq'::regclass);


--
-- Data for Name: activity_events; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.activity_events (id, entity_type, entity_id, event_type, actor_id, actor_label, meta, created_at) FROM stdin;
1	repair_order	10	created	9	admin	{"status": "open", "vehicleId": 9, "customerId": 6, "orderNumber": "RO-1010"}	2026-05-03 11:59:53.057801
2	customer	6	created	9	admin	{"status": "open", "mirrorOf": {"entityId": 10, "entityType": "repair_order"}, "vehicleId": 9, "customerId": 6, "orderNumber": "RO-1010"}	2026-05-03 11:59:53.057801
3	supplier	2	created	9	admin	{"name": "AutoZone Test"}	2026-05-03 12:24:30.069012
4	supplier	2	deleted	9	admin	{"name": "AutoZone Test"}	2026-05-03 12:24:37.453128
5	supplier	3	created	9	admin	{"name": "Acme-rw70kZ"}	2026-05-03 12:29:26.031048
6	supplier	3	updated	9	admin	{"name": "Acme-rw70kZ"}	2026-05-03 12:30:01.064545
7	repair_order	11	created	9	admin	{"status": "pending", "vehicleId": 9, "customerId": 6, "orderNumber": "RO-1011"}	2026-05-05 01:29:14.378599
8	customer	6	created	9	admin	{"status": "pending", "mirrorOf": {"entityId": 11, "entityType": "repair_order"}, "vehicleId": 9, "customerId": 6, "orderNumber": "RO-1011"}	2026-05-05 01:29:14.378599
9	repair_order	11	status_changed	9	admin	{"to": "completed", "from": "pending"}	2026-05-05 01:29:47.837897
10	customer	6	status_changed	9	admin	{"to": "completed", "from": "pending", "mirrorOf": {"entityId": 11, "entityType": "repair_order"}}	2026-05-05 01:29:47.837897
11	repair_order	11	email_sent	9	admin	{"to": "jane.web@example.com", "template": "repair_order_completed"}	2026-05-05 01:29:48.113834
12	customer	6	email_sent	9	admin	{"to": "jane.web@example.com", "mirrorOf": {"entityId": 11, "entityType": "repair_order"}, "template": "repair_order_completed"}	2026-05-05 01:29:48.113834
13	repair_order	11	deleted	9	admin	{"orderNumber": "RO-1011"}	2026-07-04 17:20:24.954311
14	customer	6	deleted	9	admin	{"mirrorOf": {"entityId": 11, "entityType": "repair_order"}, "orderNumber": "RO-1011"}	2026-07-04 17:20:24.954311
15	repair_order	10	deleted	9	admin	{"orderNumber": "RO-1010"}	2026-07-04 17:20:30.491701
16	customer	6	deleted	9	admin	{"mirrorOf": {"entityId": 10, "entityType": "repair_order"}, "orderNumber": "RO-1010"}	2026-07-04 17:20:30.491701
\.


--
-- Data for Name: appointments; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.appointments (id, customer_id, vehicle_id, assigned_to_id, status, service_type, description, scheduled_at, estimated_duration, notes, created_at, updated_at) FROM stdin;
1	1	1	1	scheduled	Oil Change	Full synthetic oil change and multi-point inspection	2026-03-31 05:53:55.037199	60	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
2	2	2	3	confirmed	Brake Service	Front brake replacement	2026-03-31 07:53:55.037199	180	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
3	3	4	5	scheduled	Diagnostics	Check engine light diagnosis	2026-04-01 03:53:55.037199	120	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
4	4	5	1	completed	Tune-Up	Annual tune-up completed	2026-03-28 03:53:55.037199	150	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
5	5	6	3	completed	Oil Change	Synthetic oil change	2026-03-26 03:53:55.037199	45	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
6	2	2	\N	scheduled	Oil Change	\N	2026-03-31 08:20:00	60	\N	2026-03-31 04:21:08.267346	2026-03-31 04:21:08.267346
7	6	9	\N	scheduled	Oil change & inspection	\N	2026-05-15 10:30:00	\N	approved via test	2026-05-02 22:17:56.451353	2026-05-02 23:13:40.609
\.


--
-- Data for Name: attachments; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.attachments (id, owner_type, owner_id, file_name, mime_type, size, storage_path, notes, uploaded_by_id, created_at) FROM stdin;
5	repair_order	9	Screenshot_20260501_193442.jpg	image/jpeg	184910	owners/repair_order/9/1777782844022-Screenshot_20260501_193442.jpg	\N	9	2026-05-03 04:34:04.064431
\.


--
-- Data for Name: canned_jobs; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.canned_jobs (id, name, category, description, estimated_hours, items, created_at, updated_at) FROM stdin;
1	Front Brake Service	Brakes	\N	1.50	[{"type": "labor", "quantity": 1.5, "unitPrice": 120, "description": "Replace front brake pads & rotors"}, {"type": "part", "quantity": 1, "unitPrice": 65, "description": "Front brake pads (set)"}]	2026-05-03 05:32:06.533809	2026-05-03 05:32:06.533809
\.


--
-- Data for Name: customer_categories; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.customer_categories (id, name, description, labor_rate, parts_markup, created_at, updated_at) FROM stdin;
1	Vip		80.00	1.50	2026-04-05 20:50:40.24775	2026-04-05 20:50:40.24775
\.


--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.customers (id, first_name, last_name, email, phone, address, city, state, zip, notes, created_at, updated_at, category_id, preferred_channel, sms_opt_out, tax_exempt, tax_exempt_number, square_customer_id) FROM stdin;
2	Sarah	Thompson	sarah.t@email.com	(555) 345-6789	87 Pine Ave	Austin	TX	78702	Fleet account - 3 vehicles	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	\N	email	false	f	\N	\N
3	Robert	Chen	rchen@email.com	(555) 456-7890	315 Maple Dr	Round Rock	TX	78664	\N	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	\N	email	false	f	\N	\N
4	Emily	Williams	emily.w@email.com	(555) 567-8901	29 Cedar Ln	Pflugerville	TX	78660	Senior discount applies	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	\N	email	false	f	\N	\N
5	Marcus	Johnson	marcus.j@email.com	(555) 678-9012	1028 Elm St	Austin	TX	78703	Referred by James Martinez	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	\N	email	false	f	\N	\N
1	James	Martinez	james.martinez@email.com	(555) 234-5678	142 Oak Street	Austin	TX	78701	Regular customer, prefers morning appointments (updated)	2026-03-31 03:52:28.68589	2026-04-20 01:56:47.616	\N	email	false	f	\N	\N
6	Jane	Webform	jane.web@example.com	555-0199					Created via web form	2026-05-02 22:17:56.226863	2026-05-03 08:58:31.835	\N	email	false	f	\N	\N
\.


--
-- Data for Name: email_templates; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.email_templates (id, key, name, subject, body_html, from_name, from_email, enabled, updated_at) FROM stdin;
1	appointment_confirmed	Appointment Confirmation	Your appointment is confirmed - {{shopName}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #f59e0b; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Appointment Confirmed</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    <p>Hi {{customerName}},</p>\n    <p>Great news — your appointment with <strong>{{shopName}}</strong> has been confirmed.</p>\n    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">\n      <tr><td style="padding: 8px 0; color: #6b7280;">Date & Time</td><td style="padding: 8px 0; font-weight: bold;">{{appointmentDateTime}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Service</td><td style="padding: 8px 0; font-weight: bold;">{{serviceType}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Vehicle</td><td style="padding: 8px 0; font-weight: bold;">{{vehicleInfo}}</td></tr>\n    </table>\n    <p>If you need to reschedule or have any questions, please reply to this email or call us.</p>\n    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">\n      Thank you for choosing {{shopName}}!\n    </p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-05-02 23:12:58.087021
2	invoice_sent	Invoice Sent	Invoice {{invoiceNumber}} from {{shopName}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Invoice Ready</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>Hi {{customerName}},</p>\n    <p>Your invoice from <strong>{{shopName}}</strong> is ready.</p>\n    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">\n      <tr><td style="padding: 8px 0; color: #6b7280;">Invoice #</td><td style="padding: 8px 0; font-weight: bold;">{{invoiceNumber}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Total</td><td style="padding: 8px 0; font-weight: bold;">{{total}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Balance Due</td><td style="padding: 8px 0; font-weight: bold;">{{balance}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Due Date</td><td style="padding: 8px 0; font-weight: bold;">{{dueDate}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Vehicle</td><td style="padding: 8px 0; font-weight: bold;">{{vehicleInfo}}</td></tr>\n    </table>\n    {{payLinkSection}}\n    <p>Please reply to this email if you have any questions about the charges.</p>\n    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">\n      Thank you for choosing {{shopName}}!\n    </p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-05-03 05:36:37.78237
7	inspection_sent	Inspection Sent	Your vehicle inspection is ready - {{shopName}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #0d9488; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Vehicle Inspection Ready</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>Hi {{customerName}},</p>\n    <p>We've completed a digital inspection of your <strong>{{vehicleInfo}}</strong> at <strong>{{shopName}}</strong>.</p>\n    <p>Tap the button below to see condition photos and approve or decline any recommended work — right from your phone.</p>\n    <p style="text-align:center;margin:28px 0;">\n      <a href="{{inspectionUrl}}" style="background:#0d9488;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-weight:bold;">View Inspection</a>\n    </p>\n    <p style="font-size:12px;color:#6b7280;word-break:break-all;">Or open this link: {{inspectionUrl}}</p>\n    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">\n      Thank you for choosing {{shopName}}!\n    </p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-05-03 09:17:49.287747
3	repair_order_completed	Repair Order Completed	Your vehicle is ready for pickup - {{shopName}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #16a34a; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Your Vehicle Is Ready</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>Hi {{customerName}},</p>\n    <p>Good news — work on your <strong>{{vehicleInfo}}</strong> is complete and your vehicle is ready for pickup.</p>\n    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">\n      <tr><td style="padding: 8px 0; color: #6b7280;">Order #</td><td style="padding: 8px 0; font-weight: bold;">{{orderNumber}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Work Done</td><td style="padding: 8px 0; font-weight: bold;">{{diagnosis}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Mileage Out</td><td style="padding: 8px 0; font-weight: bold;">{{mileageOut}}</td></tr>\n    </table>\n    <p>Please give us a call or stop by during business hours to pick up your vehicle. An invoice will follow shortly if it hasn't already.</p>\n    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">\n      Thanks for trusting {{shopName}} with your vehicle.\n    </p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-05-03 05:36:37.81963
4	service_reminder	Service Reminder	Time for your {{serviceType}} - {{shopName}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #f59e0b; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Service Reminder</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>Hi {{customerName}},</p>\n    <p>This is a friendly reminder from <strong>{{shopName}}</strong> that your <strong>{{vehicleInfo}}</strong> is due for service.</p>\n    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">\n      <tr><td style="padding: 8px 0; color: #6b7280;">Service</td><td style="padding: 8px 0; font-weight: bold;">{{serviceType}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Due Date</td><td style="padding: 8px 0; font-weight: bold;">{{dueDate}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Due Mileage</td><td style="padding: 8px 0; font-weight: bold;">{{dueMileage}}</td></tr>\n    </table>\n    <p>Reply to this email or give us a call to schedule your appointment.</p>\n    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">\n      {{shopName}}\n    </p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-05-03 05:36:37.82421
5	payment_received	Payment Receipt	Payment received - {{shopName}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #0ea5e9; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Payment Received</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>Hi {{customerName}},</p>\n    <p>We've received your payment — thank you!</p>\n    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">\n      <tr><td style="padding: 8px 0; color: #6b7280;">Invoice #</td><td style="padding: 8px 0; font-weight: bold;">{{invoiceNumber}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Amount Paid</td><td style="padding: 8px 0; font-weight: bold;">{{amount}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Method</td><td style="padding: 8px 0; font-weight: bold;">{{method}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Reference</td><td style="padding: 8px 0; font-weight: bold;">{{referenceNumber}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Remaining Balance</td><td style="padding: 8px 0; font-weight: bold;">{{balance}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Paid On</td><td style="padding: 8px 0; font-weight: bold;">{{paidAt}}</td></tr>\n    </table>\n    <p>Keep this email as your receipt.</p>\n    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">\n      Thank you for your business — {{shopName}}\n    </p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-05-03 05:36:37.831298
6	estimate_sent	Estimate Sent	Estimate {{estimateNumber}} from {{shopName}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #7c3aed; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Estimate Ready for Review</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>Hi {{customerName}},</p>\n    <p>Your estimate from <strong>{{shopName}}</strong> is ready for your review.</p>\n    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">\n      <tr><td style="padding: 8px 0; color: #6b7280;">Estimate #</td><td style="padding: 8px 0; font-weight: bold;">{{estimateNumber}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Total</td><td style="padding: 8px 0; font-weight: bold;">{{total}}</td></tr>\n    </table>\n    <p style="text-align:center;margin:28px 0;">\n      <a href="{{estimateUrl}}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-weight:bold;">Review & approve</a>\n    </p>\n    <p style="font-size:12px;color:#6b7280;word-break:break-all;">Or open this link: {{estimateUrl}}</p>\n    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">\n      Thank you for choosing {{shopName}}!\n    </p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-05-03 09:04:50.860833
8	password_reset_request	Password Reset Request	Password reset request for {{requesterUsername}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #b91c1c; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Password Reset Request</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>A user has requested a password reset. No password or reset link was generated.</p>\n    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">\n      <tr><td style="padding: 8px 0; color: #6b7280;">Username</td><td style="padding: 8px 0; font-weight: bold;">{{requesterUsername}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Name</td><td style="padding: 8px 0; font-weight: bold;">{{requesterName}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Email</td><td style="padding: 8px 0; font-weight: bold;">{{requesterEmail}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Requested at</td><td style="padding: 8px 0; font-weight: bold;">{{requestedAt}}</td></tr>\n    </table>\n    <p>Use the authenticated Users page to manually set a new password for this user. Do not send passwords by email.</p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-09-05 00:34:10.584074
9	password_reset_self_service	Password Reset Self-Service	Reset your 915motors password	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Reset Your Password</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>Hi {{requesterName}},</p>\n    <p>Use the secure link below to choose a new password for your 915motors account.</p>\n    <p style="text-align:center;margin:28px 0;">\n      <a href="{{resetUrl}}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-weight:bold;">Reset password</a>\n    </p>\n    <p style="font-size:12px;color:#6b7280;word-break:break-all;">Or open this link: {{resetUrl}}</p>\n    <p>This link expires in {{expiresIn}} and can only be used once. Never share this link with anyone.</p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-09-05 00:55:18.649572
\.


--
-- Data for Name: employees; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.employees (id, first_name, last_name, email, phone, role, hourly_rate, active, hire_date, notes, clocked_in, created_at, updated_at, roles, username, password_hash, last_login_at) FROM stdin;
1	Tony	Alvarez	tony@shopOS.com	(555) 100-1001	technician	28.00	t	2021-03-15	\N	f	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	{technician}	\N	\N	\N
2	Megan	Park	megan@shopOS.com	(555) 100-1002	service_advisor	22.00	t	2022-06-01	\N	f	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	{service_advisor}	\N	\N	\N
3	Derek	Burns	derek@shopOS.com	(555) 100-1003	technician	30.00	t	2020-09-10	\N	f	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	{technician}	\N	\N	\N
4	Lisa	Nguyen	lisa@shopOS.com	(555) 100-1004	manager	45.00	t	2019-01-20	\N	f	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	{manager}	\N	\N	\N
5	Carlos	Rivera	carlos@shopOS.com	(555) 100-1005	technician	26.00	t	2023-02-14	\N	f	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	{technician}	\N	\N	\N
10	Test	Tech-1777759184340	\N	\N	viewer	\N	t	\N	\N	f	2026-05-02 22:02:12.044684	2026-05-02 22:02:12.044684	{viewer,technician}	testtech184340	$2b$10$pGSrXgpMX9SiTq1pgWxyhO0w4M61OVP6mqb2YEjsV9AaFSGVMQgka	2026-05-02 22:02:37.096222
11	Test	Tech1777759464061	\N	\N	technician	\N	t	\N	\N	t	2026-05-02 22:05:19.844664	2026-07-03 06:17:40.709	{technician}	tt464061	$2b$10$feK.2tgOzsLxqymU2xw/xuN.FEeKZLQOncT0XPYuAJrJn9sfhI4Sy	2026-05-02 22:05:38.175625
9	Admin	User	915motorsusa@gmail.com	\N	admin	\N	t	\N	\N	f	2026-05-02 21:58:14.522499	2026-09-05 01:26:01.924843	{admin}	admin	$2b$10$GdBj.lKTGLaHYJ717SNwp.yBvqDzcsfvWl6tmfawHxs0fycKHRGgi	2026-09-04 03:25:03.949067
\.


--
-- Data for Name: estimate_approval_items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.estimate_approval_items (id, approval_id, estimate_item_id, decision) FROM stdin;
\.


--
-- Data for Name: estimate_approvals; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.estimate_approvals (id, estimate_revision_id, decision, signer_name, signer_email, signature_url, document_hash, request_ip, request_user_agent, decided_at, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: estimate_items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.estimate_items (id, estimate_revision_id, "position", kind, description, quantity, unit_price, unit_cost, inventory_item_id, estimated_hours, warranty_months, warranty_miles) FROM stdin;
\.


--
-- Data for Name: estimate_revisions; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.estimate_revisions (id, repair_order_id, revision_no, kind, status, notes, customer_snapshot, vehicle_snapshot, subtotal, tax_rate_bps, tax_amount, total, public_token, sent_at, created_by_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: expenses; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.expenses (id, category, description, amount, vendor, receipt_number, expense_date, notes, created_at, updated_at) FROM stdin;
1	Supplies	Shop towels and cleaning supplies	87.50	Home Depot	\N	2026-03-29	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
2	Parts Purchase	Brake parts bulk order	450.00	NAPA Auto Parts	\N	2026-03-26	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
3	Equipment	New tire changing machine maintenance	125.00	Hunter Engineering	\N	2026-03-23	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
4	Utilities	Monthly electricity bill	380.00	City Electric	\N	2026-03-30	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
5	Marketing	Local newspaper ad	150.00	Austin Chronicle	\N	2026-03-21	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
\.


--
-- Data for Name: idempotency_keys; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.idempotency_keys (id, scope, key, request_hash, response_status, response_body, completed_at, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: inspections; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.inspections (id, vehicle_id, repair_order_id, inspected_by_id, type, mileage, overall_condition, items, notes, created_at, updated_at, public_token, sent_at, customer_signature_url, customer_signed_at, customer_signer_name, customer_ip) FROM stdin;
1	1	\N	1	Multi-Point Inspection	62400	good	[{"label": "Engine Oil Level", "notes": "Changed today", "status": "ok"}, {"label": "Tire Tread Depth", "status": "ok"}, {"label": "Brake Pads Front", "status": "ok"}, {"label": "Brake Pads Rear", "notes": "20% remaining, monitor", "status": "needs_attention"}, {"label": "Air Filter", "status": "ok"}, {"label": "Battery", "notes": "73% health", "status": "ok"}, {"label": "Lights", "status": "ok"}, {"label": "Windshield Wipers", "notes": "Starting to streak", "status": "needs_attention"}]	Overall vehicle in good condition	2026-03-30 03:53:55.037199	2026-03-31 03:53:55.037199	\N	\N	\N	\N	\N	\N
2	5	\N	3	Pre-Service Inspection	91200	fair	[{"label": "Engine Oil Level", "notes": "Low - needs change", "status": "urgent"}, {"label": "Spark Plugs", "notes": "Replaced during service", "status": "urgent"}, {"label": "Air Filter", "status": "needs_attention"}, {"label": "Brake Pads Front", "status": "ok"}, {"label": "Tire Pressure", "notes": "All tires 5 PSI low", "status": "needs_attention"}]	Several items addressed during service	2026-03-28 03:53:55.037199	2026-03-31 03:53:55.037199	\N	\N	\N	\N	\N	\N
3	2	\N	\N	Multi-Point Inspection	\N	good	[{"label": "TtTurakes", "status": "ok"}, {"label": "Tires", "status": "ok"}, {"label": "Fluids", "status": "ok"}, {"label": "Ty", "status": "ok"}]	\N	2026-03-31 04:20:36.537118	2026-03-31 04:20:36.537118	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: inventory; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.inventory (id, part_number, name, description, category, vendor, cost_price, sell_price, quantity, min_quantity, location, notes, created_at, updated_at, compatible_vehicles, preferred_supplier_id, default_warranty_months, default_warranty_miles, square_catalog_object_id, square_location_id) FROM stdin;
1	OIL-5W30-5QT	Mobil 1 5W-30 Motor Oil 5Qt	\N	Oil & Fluids	AutoParts Plus	18.50	34.99	48	10	Aisle A-1	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
2	FLT-OIL-01234	Standard Oil Filter	\N	Filters	AutoParts Plus	4.25	9.99	85	20	Aisle A-2	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
3	BRK-PAD-FRT	Premium Front Brake Pads	\N	Brakes	NAPA Auto Parts	22.00	59.99	12	5	Aisle B-3	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
4	BRK-RTR-FRT	OEM Front Brake Rotor	\N	Brakes	NAPA Auto Parts	38.00	89.99	7	3	Aisle B-4	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
5	SRK-PLG-IRID	Iridium Spark Plugs (Set of 4)	\N	Ignition	NGK	28.00	54.99	30	8	Aisle C-1	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
6	FLT-AIR-HON	Honda Air Filter	\N	Filters	Honda OEM	14.00	29.99	3	5	Aisle A-3	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
7	TRN-FLD-ATF	Dexron VI ATF Transmission Fluid	\N	Oil & Fluids	AutoParts Plus	8.00	16.99	24	6	Aisle A-4	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
8	TRS-BLT-SERP	Serpentine Belt	\N	Belts & Hoses	Gates	16.00	38.99	2	4	Aisle D-2	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
9	3445	Alternator 	\N	Charging system	\N	0.00	0.00	0	5	\N	\N	2026-04-01 04:05:04.170012	2026-04-01 04:05:04.170012	\N	\N	\N	\N	\N	\N
10		Front brake pads 	\N	Brakes		0.00	0.00	0	5			2026-04-01 04:28:35.594594	2026-04-01 04:28:35.594594	Toyota camery 2008-2026	\N	\N	\N	\N	\N
11	BP-T33	TASK33 Brake Pad	\N	Brakes		20.00	50.00	5	1			2026-05-05 01:27:56.650432	2026-07-04 17:20:24.944		\N	12	12000	\N	\N
\.


--
-- Data for Name: invoice_items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.invoice_items (id, invoice_id, source_work_item_id, "position", kind, description, quantity, unit_price, unit_cost, line_total) FROM stdin;
\.


--
-- Data for Name: invoices; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.invoices (id, invoice_number, repair_order_id, customer_snapshot, vehicle_snapshot, status, notes, subtotal, tax_rate_bps, tax_amount, total, amount_paid, balance, tax_exempt, tax_exempt_number, public_token, issued_at, issued_by_id, voided_at, voided_by_id, void_reason, version, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: messages; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.messages (id, customer_id, repair_order_id, estimate_id, invoice_id, direction, channel, from_number, to_number, body, status, failure_reason, twilio_sid, read_at, sent_by_user_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: njmvc_categories; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.njmvc_categories (id, name, sort_order, active, notes, created_at, updated_at) FROM stdin;
1	Brake System	0	t	\N	2026-04-09 03:44:08.871612	2026-04-09 03:44:08.871612
2	Brake Linings	1	t	\N	2026-04-09 03:44:08.913326	2026-04-09 03:44:08.913326
3	Lighting Devices	2	t	\N	2026-04-09 03:44:08.91969	2026-04-09 03:44:08.91969
4	Glass/Glazing	3	t	\N	2026-04-09 03:44:08.926664	2026-04-09 03:44:08.926664
5	Doors	4	t	\N	2026-04-09 03:44:08.933307	2026-04-09 03:44:08.933307
6	Fuel System	5	t	\N	2026-04-09 03:44:08.948358	2026-04-09 03:44:08.948358
7	Tires	6	t	\N	2026-04-09 03:44:08.955351	2026-04-09 03:44:08.955351
8	Steering Mechanism	7	t	\N	2026-04-09 03:44:08.962579	2026-04-09 03:44:08.962579
9	Safety Equipment (If Applicable)	8	t	\N	2026-04-09 03:44:08.969387	2026-04-09 03:44:08.969387
10	Underbody	9	t	\N	2026-04-09 03:44:08.97526	2026-04-09 03:44:08.97526
11	Wipers	10	t	\N	2026-04-09 03:44:08.981088	2026-04-09 03:44:08.981088
12	Exhaust System	11	t	\N	2026-04-09 03:44:08.986693	2026-04-09 03:44:08.986693
13	Transmission	12	t	\N	2026-04-09 03:44:08.992573	2026-04-09 03:44:08.992573
14	Bus Exterior	13	t	\N	2026-04-09 03:44:08.997823	2026-04-09 03:44:08.997823
15	Underhood	14	t	\N	2026-04-09 03:44:09.00291	2026-04-09 03:44:09.00291
16	Emergency Exit	15	t	\N	2026-04-09 03:44:09.008143	2026-04-09 03:44:09.008143
17	Bus Interior	16	t	\N	2026-04-09 03:44:09.013284	2026-04-09 03:44:09.013284
18	Differential	17	t	\N	2026-04-09 03:44:09.019569	2026-04-09 03:44:09.019569
19	Mirrors	18	t	\N	2026-04-09 03:44:09.024679	2026-04-09 03:44:09.024679
20	Handicapped (If Applicable)	19	t	\N	2026-04-09 03:44:09.030236	2026-04-09 03:44:09.030236
\.


--
-- Data for Name: njmvc_inspection_results; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.njmvc_inspection_results (id, inspection_id, item_id, status, repaired_date, measurement_value, notes, created_at) FROM stdin;
189	2	1	ok	\N	\N	\N	2026-04-09 05:20:29.203331
190	2	2	ok	\N	\N	\N	2026-04-09 05:20:29.203331
191	2	3	ok	\N	\N	\N	2026-04-09 05:20:29.203331
192	2	4	ok	\N	\N	\N	2026-04-09 05:20:29.203331
193	2	5	ok	\N	\N	\N	2026-04-09 05:20:29.203331
194	2	6	ok	\N	\N	\N	2026-04-09 05:20:29.203331
195	2	7	ok	\N	\N	\N	2026-04-09 05:20:29.203331
196	2	8	ok	\N	\N	\N	2026-04-09 05:20:29.203331
197	2	9	ok	\N	\N	\N	2026-04-09 05:20:29.203331
198	2	10	ok	\N	\N	\N	2026-04-09 05:20:29.203331
199	2	11	ok	\N	\N	\N	2026-04-09 05:20:29.203331
200	2	12	ok	\N	\N	\N	2026-04-09 05:20:29.203331
201	2	13	ok	\N	\N	\N	2026-04-09 05:20:29.203331
202	2	14	ok	\N	\N	\N	2026-04-09 05:20:29.203331
203	2	15	ok	\N	\N	\N	2026-04-09 05:20:29.203331
204	2	16	needs_repair	2026-03-03	\N	\N	2026-04-09 05:20:29.203331
205	2	17	ok	\N	\N	\N	2026-04-09 05:20:29.203331
206	2	18	ok	\N	\N	\N	2026-04-09 05:20:29.203331
207	2	19	ok	\N	\N	\N	2026-04-09 05:20:29.203331
208	2	20	ok	\N	\N	\N	2026-04-09 05:20:29.203331
209	2	21	ok	\N	\N	\N	2026-04-09 05:20:29.203331
210	2	22	ok	\N	\N	\N	2026-04-09 05:20:29.203331
211	2	23	ok	\N	\N	\N	2026-04-09 05:20:29.203331
212	2	24	ok	\N	\N	\N	2026-04-09 05:20:29.203331
213	2	25	ok	\N	\N	\N	2026-04-09 05:20:29.203331
214	2	26	ok	\N	\N	\N	2026-04-09 05:20:29.203331
215	2	27	ok	\N	\N	\N	2026-04-09 05:20:29.203331
216	2	28	ok	\N	\N	\N	2026-04-09 05:20:29.203331
217	2	29	ok	\N	\N	\N	2026-04-09 05:20:29.203331
218	2	30	ok	\N	\N	\N	2026-04-09 05:20:29.203331
219	2	31	ok	\N	\N	\N	2026-04-09 05:20:29.203331
220	2	32	ok	\N	\N	\N	2026-04-09 05:20:29.203331
221	2	33	ok	\N	\N	\N	2026-04-09 05:20:29.203331
222	2	34	ok	\N	\N	\N	2026-04-09 05:20:29.203331
223	2	35	ok	\N	\N	\N	2026-04-09 05:20:29.203331
224	2	36	ok	\N	\N	\N	2026-04-09 05:20:29.203331
225	2	37	ok	\N	\N	\N	2026-04-09 05:20:29.203331
226	2	38	ok	\N	\N	\N	2026-04-09 05:20:29.203331
227	2	39	ok	\N	\N	\N	2026-04-09 05:20:29.203331
228	2	40	ok	\N	\N	\N	2026-04-09 05:20:29.203331
229	2	41	ok	\N	\N	\N	2026-04-09 05:20:29.203331
230	2	42	ok	\N	\N	\N	2026-04-09 05:20:29.203331
231	2	43	ok	\N	\N	\N	2026-04-09 05:20:29.203331
232	2	44	ok	\N	\N	\N	2026-04-09 05:20:29.203331
233	2	45	ok	\N	\N	\N	2026-04-09 05:20:29.203331
234	2	46	ok	\N	\N	\N	2026-04-09 05:20:29.203331
235	2	47	ok	\N	\N	\N	2026-04-09 05:20:29.203331
236	2	48	ok	\N	\N	\N	2026-04-09 05:20:29.203331
237	2	49	ok	\N	\N	\N	2026-04-09 05:20:29.203331
238	2	50	ok	\N	\N	\N	2026-04-09 05:20:29.203331
239	2	51	ok	\N	\N	\N	2026-04-09 05:20:29.203331
240	2	52	ok	\N	\N	\N	2026-04-09 05:20:29.203331
241	2	53	ok	\N	\N	\N	2026-04-09 05:20:29.203331
242	2	54	ok	\N	\N	\N	2026-04-09 05:20:29.203331
243	2	55	ok	\N	\N	\N	2026-04-09 05:20:29.203331
244	2	56	ok	\N	\N	\N	2026-04-09 05:20:29.203331
245	2	57	ok	\N	\N	\N	2026-04-09 05:20:29.203331
246	2	58	needs_repair	2026-04-02	\N	\N	2026-04-09 05:20:29.203331
247	2	59	ok	\N	\N	\N	2026-04-09 05:20:29.203331
248	2	60	ok	\N	\N	\N	2026-04-09 05:20:29.203331
249	2	61	ok	\N	\N	\N	2026-04-09 05:20:29.203331
250	2	62	ok	\N	\N	\N	2026-04-09 05:20:29.203331
251	2	63	ok	\N	\N	\N	2026-04-09 05:20:29.203331
252	2	64	ok	\N	\N	\N	2026-04-09 05:20:29.203331
253	2	65	ok	\N	\N	\N	2026-04-09 05:20:29.203331
254	2	66	ok	\N	\N	\N	2026-04-09 05:20:29.203331
255	2	67	ok	\N	\N	\N	2026-04-09 05:20:29.203331
256	2	68	ok	\N	\N	\N	2026-04-09 05:20:29.203331
257	2	69	ok	\N	\N	\N	2026-04-09 05:20:29.203331
258	2	70	ok	\N	\N	\N	2026-04-09 05:20:29.203331
259	2	71	ok	\N	\N	\N	2026-04-09 05:20:29.203331
260	2	72	ok	\N	\N	\N	2026-04-09 05:20:29.203331
261	2	73	ok	\N	\N	\N	2026-04-09 05:20:29.203331
262	2	74	ok	\N	\N	\N	2026-04-09 05:20:29.203331
263	2	75	ok	\N	\N	\N	2026-04-09 05:20:29.203331
264	2	76	ok	\N	\N	\N	2026-04-09 05:20:29.203331
265	2	77	ok	\N	\N	\N	2026-04-09 05:20:29.203331
266	2	78	ok	\N	\N	\N	2026-04-09 05:20:29.203331
267	2	79	ok	\N	\N	\N	2026-04-09 05:20:29.203331
268	2	80	ok	\N	\N	\N	2026-04-09 05:20:29.203331
269	2	81	ok	\N	\N	\N	2026-04-09 05:20:29.203331
270	2	82	ok	\N	\N	\N	2026-04-09 05:20:29.203331
271	2	83	ok	\N	\N	\N	2026-04-09 05:20:29.203331
272	2	84	ok	\N	\N	\N	2026-04-09 05:20:29.203331
273	2	85	ok	\N	\N	\N	2026-04-09 05:20:29.203331
274	2	86	ok	\N	\N	\N	2026-04-09 05:20:29.203331
275	2	87	na	\N	\N	\N	2026-04-09 05:20:29.203331
276	2	88	na	\N	\N	\N	2026-04-09 05:20:29.203331
277	2	89	na	\N	\N	\N	2026-04-09 05:20:29.203331
278	2	90	na	\N	\N	\N	2026-04-09 05:20:29.203331
279	2	91	na	\N	\N	\N	2026-04-09 05:20:29.203331
280	2	92	na	\N	\N	\N	2026-04-09 05:20:29.203331
281	2	93	na	\N	\N	\N	2026-04-09 05:20:29.203331
95	1	1	ok	\N	\N	\N	2026-04-09 05:00:34.882235
96	1	2	ok	\N	\N	\N	2026-04-09 05:00:34.882235
97	1	3	needs_repair	2026-04-03	\N	\N	2026-04-09 05:00:34.882235
98	1	4	ok	\N	\N	\N	2026-04-09 05:00:34.882235
99	1	5	ok	\N	\N	\N	2026-04-09 05:00:34.882235
100	1	6	ok	\N	\N	\N	2026-04-09 05:00:34.882235
101	1	7	ok	\N	\N	\N	2026-04-09 05:00:34.882235
102	1	8	ok	\N	\N	\N	2026-04-09 05:00:34.882235
103	1	9	ok	\N	\N	\N	2026-04-09 05:00:34.882235
104	1	10	ok	\N	\N	\N	2026-04-09 05:00:34.882235
105	1	11	ok	\N	\N	\N	2026-04-09 05:00:34.882235
106	1	12	needs_repair	2026-03-04	\N	\N	2026-04-09 05:00:34.882235
107	1	13	ok	\N	\N	\N	2026-04-09 05:00:34.882235
108	1	14	ok	\N	\N	\N	2026-04-09 05:00:34.882235
109	1	15	ok	\N	\N	\N	2026-04-09 05:00:34.882235
110	1	16	ok	\N	\N	\N	2026-04-09 05:00:34.882235
111	1	17	ok	\N	\N	\N	2026-04-09 05:00:34.882235
112	1	18	ok	\N	\N	\N	2026-04-09 05:00:34.882235
113	1	19	ok	\N	\N	\N	2026-04-09 05:00:34.882235
114	1	20	ok	\N	\N	\N	2026-04-09 05:00:34.882235
115	1	21	ok	\N	\N	\N	2026-04-09 05:00:34.882235
116	1	22	ok	\N	\N	\N	2026-04-09 05:00:34.882235
117	1	23	ok	\N	\N	\N	2026-04-09 05:00:34.882235
118	1	24	ok	\N	\N	\N	2026-04-09 05:00:34.882235
119	1	25	ok	\N	\N	\N	2026-04-09 05:00:34.882235
120	1	26	ok	\N	\N	\N	2026-04-09 05:00:34.882235
121	1	27	ok	\N	\N	\N	2026-04-09 05:00:34.882235
122	1	28	ok	\N	\N	\N	2026-04-09 05:00:34.882235
123	1	29	ok	\N	\N	\N	2026-04-09 05:00:34.882235
124	1	30	ok	\N	\N	\N	2026-04-09 05:00:34.882235
125	1	31	ok	\N	\N	\N	2026-04-09 05:00:34.882235
126	1	32	ok	\N	\N	\N	2026-04-09 05:00:34.882235
127	1	33	ok	\N	\N	\N	2026-04-09 05:00:34.882235
128	1	34	ok	\N	\N	\N	2026-04-09 05:00:34.882235
129	1	35	ok	\N	\N	\N	2026-04-09 05:00:34.882235
130	1	36	ok	\N	\N	\N	2026-04-09 05:00:34.882235
131	1	37	ok	\N	\N	\N	2026-04-09 05:00:34.882235
132	1	38	ok	\N	\N	\N	2026-04-09 05:00:34.882235
133	1	39	ok	\N	\N	\N	2026-04-09 05:00:34.882235
134	1	40	ok	\N	\N	\N	2026-04-09 05:00:34.882235
135	1	41	ok	\N	\N	\N	2026-04-09 05:00:34.882235
136	1	42	ok	\N	\N	\N	2026-04-09 05:00:34.882235
137	1	43	ok	\N	\N	\N	2026-04-09 05:00:34.882235
138	1	44	ok	\N	\N	\N	2026-04-09 05:00:34.882235
139	1	45	ok	\N	\N	\N	2026-04-09 05:00:34.882235
140	1	46	ok	\N	\N	\N	2026-04-09 05:00:34.882235
141	1	47	ok	\N	\N	\N	2026-04-09 05:00:34.882235
142	1	48	ok	\N	\N	\N	2026-04-09 05:00:34.882235
143	1	49	ok	\N	\N	\N	2026-04-09 05:00:34.882235
144	1	50	ok	\N	\N	\N	2026-04-09 05:00:34.882235
145	1	51	ok	\N	\N	\N	2026-04-09 05:00:34.882235
146	1	52	ok	\N	\N	\N	2026-04-09 05:00:34.882235
147	1	53	ok	\N	\N	\N	2026-04-09 05:00:34.882235
148	1	54	ok	\N	\N	\N	2026-04-09 05:00:34.882235
149	1	55	ok	\N	\N	\N	2026-04-09 05:00:34.882235
150	1	56	ok	\N	\N	\N	2026-04-09 05:00:34.882235
151	1	57	ok	\N	\N	\N	2026-04-09 05:00:34.882235
152	1	58	ok	\N	\N	\N	2026-04-09 05:00:34.882235
153	1	59	ok	\N	\N	\N	2026-04-09 05:00:34.882235
154	1	60	ok	\N	\N	\N	2026-04-09 05:00:34.882235
155	1	61	ok	\N	\N	\N	2026-04-09 05:00:34.882235
156	1	62	ok	\N	\N	\N	2026-04-09 05:00:34.882235
157	1	63	ok	\N	\N	\N	2026-04-09 05:00:34.882235
158	1	64	ok	\N	\N	\N	2026-04-09 05:00:34.882235
159	1	65	ok	\N	\N	\N	2026-04-09 05:00:34.882235
160	1	66	ok	\N	\N	\N	2026-04-09 05:00:34.882235
161	1	67	ok	\N	\N	\N	2026-04-09 05:00:34.882235
162	1	68	ok	\N	\N	\N	2026-04-09 05:00:34.882235
163	1	69	ok	\N	\N	\N	2026-04-09 05:00:34.882235
164	1	70	ok	\N	\N	\N	2026-04-09 05:00:34.882235
165	1	71	ok	\N	\N	\N	2026-04-09 05:00:34.882235
166	1	72	ok	\N	\N	\N	2026-04-09 05:00:34.882235
167	1	73	ok	\N	\N	\N	2026-04-09 05:00:34.882235
168	1	74	ok	\N	\N	\N	2026-04-09 05:00:34.882235
169	1	75	ok	\N	\N	\N	2026-04-09 05:00:34.882235
170	1	76	ok	\N	\N	\N	2026-04-09 05:00:34.882235
171	1	77	ok	\N	\N	\N	2026-04-09 05:00:34.882235
172	1	78	ok	\N	\N	\N	2026-04-09 05:00:34.882235
173	1	79	ok	\N	\N	\N	2026-04-09 05:00:34.882235
174	1	80	ok	\N	\N	\N	2026-04-09 05:00:34.882235
175	1	81	ok	\N	\N	\N	2026-04-09 05:00:34.882235
176	1	82	ok	\N	\N	\N	2026-04-09 05:00:34.882235
177	1	83	ok	\N	\N	\N	2026-04-09 05:00:34.882235
178	1	84	ok	\N	\N	\N	2026-04-09 05:00:34.882235
179	1	85	ok	\N	\N	\N	2026-04-09 05:00:34.882235
180	1	86	ok	\N	\N	\N	2026-04-09 05:00:34.882235
181	1	87	ok	\N	\N	\N	2026-04-09 05:00:34.882235
182	1	88	ok	\N	\N	\N	2026-04-09 05:00:34.882235
183	1	89	ok	\N	\N	\N	2026-04-09 05:00:34.882235
184	1	90	ok	\N	\N	\N	2026-04-09 05:00:34.882235
185	1	91	ok	\N	\N	\N	2026-04-09 05:00:34.882235
186	1	92	ok	\N	\N	\N	2026-04-09 05:00:34.882235
187	1	93	ok	\N	\N	\N	2026-04-09 05:00:34.882235
188	1	94	ok	\N	\N	\N	2026-04-09 05:00:34.882235
282	2	94	na	\N	\N	\N	2026-04-09 05:20:29.203331
\.


--
-- Data for Name: njmvc_inspections; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.njmvc_inspections (id, vehicle_id, operator_name, address, mechanic_name_print, mechanic_name_signed, report_number, fleet_unit_number, mileage, vehicle_type, vin, license_plate, inspection_date, certified_passed, notes, created_at, updated_at, purchase_date) FROM stdin;
1	1	Classy Transfers 		Nabil Aly		2	4	145000	SV	1HGCM82633A004352	KXP-4521	2026-04-09	t		2026-04-09 04:59:35.142567	2026-04-09 05:00:34.856	\N
2	2	Classy Transfers 		Nabil Aly 		5	4	135000	SV	2T1BURHE0JC078901	RMQ-7733	2026-04-09	t		2026-04-09 05:20:29.026013	2026-04-09 05:20:29.026013	\N
\.


--
-- Data for Name: njmvc_items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.njmvc_items (id, category_id, label, has_measurement, measurement_unit, sort_order, active, created_at, measurement_position) FROM stdin;
1	1	a. Service Brakes	f	\N	0	t	2026-04-09 03:44:08.909163	\N
2	1	b. Parking Brake System	f	\N	1	t	2026-04-09 03:44:08.909163	\N
3	1	c. Brake Drums or Rotors	f	\N	2	t	2026-04-09 03:44:08.909163	\N
4	1	d. Brake Hose	f	\N	3	t	2026-04-09 03:44:08.909163	\N
5	1	e. Brake Tubing	f	\N	4	t	2026-04-09 03:44:08.909163	\N
6	1	f. Low Pressure Warning	f	\N	5	t	2026-04-09 03:44:08.909163	\N
7	1	g. Air Compressor	f	\N	6	t	2026-04-09 03:44:08.909163	\N
8	1	h. Vacuum Systems	f	\N	7	t	2026-04-09 03:44:08.909163	\N
9	1	i. Electric Brakes	f	\N	8	t	2026-04-09 03:44:08.909163	\N
10	1	j. Hydraulic Brakes	f	\N	9	t	2026-04-09 03:44:08.909163	\N
11	2	a. L/F	t	mm	0	t	2026-04-09 03:44:08.916981	\N
12	2	b. R/F	t	mm	1	t	2026-04-09 03:44:08.916981	\N
13	2	c. L/R	t	mm	2	t	2026-04-09 03:44:08.916981	\N
14	2	d. R/R	t	mm	3	t	2026-04-09 03:44:08.916981	\N
15	3	a. Headlights	f	\N	0	t	2026-04-09 03:44:08.923629	\N
16	3	b. Tail Lights	f	\N	1	t	2026-04-09 03:44:08.923629	\N
17	3	c. Turn Signals	f	\N	2	t	2026-04-09 03:44:08.923629	\N
18	3	d. Marker/Clearance	f	\N	3	t	2026-04-09 03:44:08.923629	\N
19	3	e. School Bus Warning	f	\N	4	t	2026-04-09 03:44:08.923629	\N
20	3	f. Indicator	f	\N	5	t	2026-04-09 03:44:08.923629	\N
21	3	g. Stop Arm/Crossing Arm	f	\N	6	t	2026-04-09 03:44:08.923629	\N
22	3	h. Back Up Alarm	f	\N	7	t	2026-04-09 03:44:08.923629	\N
23	4	a. Cracks	f	\N	0	t	2026-04-09 03:44:08.930327	\N
24	4	b. Discoloration	f	\N	1	t	2026-04-09 03:44:08.930327	\N
25	4	c. Vision Obstruction	f	\N	2	t	2026-04-09 03:44:08.930327	\N
26	5	a. Entry Steps	f	\N	0	t	2026-04-09 03:44:08.937074	\N
27	5	b. Stepwell Light	f	\N	1	t	2026-04-09 03:44:08.937074	\N
28	5	c. Door Seals	f	\N	2	t	2026-04-09 03:44:08.937074	\N
29	5	d. Grab Handles	f	\N	3	t	2026-04-09 03:44:08.937074	\N
30	6	a. Visible Leak	f	\N	0	t	2026-04-09 03:44:08.952026	\N
31	6	b. Fuel Tank Filler Cap Missing	f	\N	1	t	2026-04-09 03:44:08.952026	\N
32	6	c. Fuel Tank Mounting	f	\N	2	t	2026-04-09 03:44:08.952026	\N
33	7	a. Size	f	\N	0	t	2026-04-09 03:44:08.959091	\N
34	7	b. No. of Ply	f	\N	1	t	2026-04-09 03:44:08.959091	\N
35	7	c. L/F	t	/32"	2	t	2026-04-09 03:44:08.959091	\N
36	7	d. R/F	t	/32"	3	t	2026-04-09 03:44:08.959091	\N
37	7	e. R/R/O	t	/32"	4	t	2026-04-09 03:44:08.959091	\N
38	7	f. R/R/I	t	/32"	5	t	2026-04-09 03:44:08.959091	\N
39	7	g. L/R/I	t	/32"	6	t	2026-04-09 03:44:08.959091	\N
40	7	h. L/R/O	t	/32"	7	t	2026-04-09 03:44:08.959091	\N
41	8	a. Steering System	f	\N	0	t	2026-04-09 03:44:08.965895	\N
42	8	b. Steering Column	f	\N	1	t	2026-04-09 03:44:08.965895	\N
43	8	c. Power Steering	f	\N	2	t	2026-04-09 03:44:08.965895	\N
44	9	a. Fire Extinguisher	f	\N	0	t	2026-04-09 03:44:08.972459	\N
45	9	b. First Aid Kit	f	\N	1	t	2026-04-09 03:44:08.972459	\N
46	9	c. Portable Warning Device	f	\N	2	t	2026-04-09 03:44:08.972459	\N
47	9	d. Wrecking Bar	f	\N	3	t	2026-04-09 03:44:08.972459	\N
48	10	a. Drive Shaft/Guards	f	\N	0	t	2026-04-09 03:44:08.977751	\N
49	10	b. Spring Assembly	f	\N	1	t	2026-04-09 03:44:08.977751	\N
50	10	c. Crossmembers	f	\N	2	t	2026-04-09 03:44:08.977751	\N
51	10	d. Body Clips/Bolts	f	\N	3	t	2026-04-09 03:44:08.977751	\N
52	10	e. Shocks	f	\N	4	t	2026-04-09 03:44:08.977751	\N
53	10	f. Fluid Leaks	f	\N	5	t	2026-04-09 03:44:08.977751	\N
54	10	g. Undercoating	f	\N	6	t	2026-04-09 03:44:08.977751	\N
55	10	h. Carrier Bearings	f	\N	7	t	2026-04-09 03:44:08.977751	\N
56	11	a. Wiper Inoperable	f	\N	0	t	2026-04-09 03:44:08.984495	\N
57	11	b. Washer Inoperable	f	\N	1	t	2026-04-09 03:44:08.984495	\N
58	11	c. Wiper Blades	f	\N	2	t	2026-04-09 03:44:08.984495	\N
59	11	d. Wiper Sweep	f	\N	3	t	2026-04-09 03:44:08.984495	\N
60	12	a. Mounting	f	\N	0	t	2026-04-09 03:44:08.990204	\N
61	12	b. Leaks	f	\N	1	t	2026-04-09 03:44:08.990204	\N
62	13	Transmission	f	\N	0	t	2026-04-09 03:44:08.995254	\N
63	14	a. Condition	f	\N	0	t	2026-04-09 03:44:09.00028	\N
64	14	b. Bumpers	f	\N	1	t	2026-04-09 03:44:09.00028	\N
65	14	c. Rub Rails	f	\N	2	t	2026-04-09 03:44:09.00028	\N
66	15	a. Belts	f	\N	0	t	2026-04-09 03:44:09.005778	\N
67	15	b. Hoses	f	\N	1	t	2026-04-09 03:44:09.005778	\N
68	15	c. Battery	f	\N	2	t	2026-04-09 03:44:09.005778	\N
69	15	d. Antifreeze Leak	f	\N	3	t	2026-04-09 03:44:09.005778	\N
70	15	e. Oil Leak	f	\N	4	t	2026-04-09 03:44:09.005778	\N
71	16	a. Lettering	f	\N	0	t	2026-04-09 03:44:09.010438	\N
72	16	b. Buzzers	f	\N	1	t	2026-04-09 03:44:09.010438	\N
73	16	c. Landing Lights	f	\N	2	t	2026-04-09 03:44:09.010438	\N
74	16	d. Door Slide Bar	f	\N	3	t	2026-04-09 03:44:09.010438	\N
75	16	e. Door Handles	f	\N	4	t	2026-04-09 03:44:09.010438	\N
76	17	a. Instruments	f	\N	0	t	2026-04-09 03:44:09.016558	\N
77	17	b. Heaters	f	\N	1	t	2026-04-09 03:44:09.016558	\N
78	17	c. Defrosters	f	\N	2	t	2026-04-09 03:44:09.016558	\N
79	17	d. Lights	f	\N	3	t	2026-04-09 03:44:09.016558	\N
80	17	e. Cleanliness	f	\N	4	t	2026-04-09 03:44:09.016558	\N
81	17	f. Seats	f	\N	5	t	2026-04-09 03:44:09.016558	\N
82	18	Differential	f	\N	0	t	2026-04-09 03:44:09.021974	\N
83	19	a. Crossover	f	\N	0	t	2026-04-09 03:44:09.027005	\N
84	19	b. Rearview/Convex	f	\N	1	t	2026-04-09 03:44:09.027005	\N
85	19	c. Interior	f	\N	2	t	2026-04-09 03:44:09.027005	\N
86	19	d. Mirror Adjustment	f	\N	3	t	2026-04-09 03:44:09.027005	\N
87	20	a. Power Lift	f	\N	0	t	2026-04-09 03:44:09.03325	\N
88	20	b. Lift Door	f	\N	1	t	2026-04-09 03:44:09.03325	\N
89	20	c. Buzzer	f	\N	2	t	2026-04-09 03:44:09.03325	\N
90	20	d. Interlock	f	\N	3	t	2026-04-09 03:44:09.03325	\N
91	20	e. Identification	f	\N	4	t	2026-04-09 03:44:09.03325	\N
92	20	f. Light	f	\N	5	t	2026-04-09 03:44:09.03325	\N
93	20	g. Fluid Leaks	f	\N	6	t	2026-04-09 03:44:09.03325	\N
94	20	h. Manual Pump	f	\N	7	t	2026-04-09 03:44:09.03325	\N
\.


--
-- Data for Name: password_reset_tokens; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.password_reset_tokens (id, employee_id, token_hash, expires_at, used_at, created_at) FROM stdin;
1	9	aec64a941bce3cb34f8bea01f220a3295f6993d9611555f3d136255ea2a65a93	2026-09-05 01:57:24.756	2026-09-05 01:30:35.493	2026-09-05 01:27:24.768695
2	9	e5b7a4e3af3aaf2a2df1531778340004ceb37aa6e97bb3119d28497c91eaae1e	2026-09-05 02:00:35.493	2026-09-05 03:15:36.219	2026-09-05 01:30:35.510189
3	9	a3f572f6dccc4800bc097d9af66e9749a3fde72d985e30f4f03f9d7fdf4945a7	2026-09-05 03:45:36.219	\N	2026-09-05 03:15:36.360176
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.payments (id, invoice_id, amount, status, method, processor, processor_payment_id, processor_event_id, attempt_key, idempotency_key, parent_payment_id, reference_number, failure_reason, refunded_at, voided_at, processed_at, created_at) FROM stdin;
\.


--
-- Data for Name: processor_webhook_receipts; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.processor_webhook_receipts (id, processor, event_id, event_type, payload, received_at, processed_at, failure_reason) FROM stdin;
\.


--
-- Data for Name: purchase_line_items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.purchase_line_items (id, purchase_id, item_type, inventory_id, used_car_id, description, quantity, unit_cost, notes, created_at) FROM stdin;
1	1	inventory	10	\N	Front brake pads 	1.00	35.00	\N	2026-04-18 22:15:44.717058
\.


--
-- Data for Name: purchases; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.purchases (id, supplier_legacy, supplier_contact, supplier_email, supplier_phone, invoice_number, amount, tax, shipping, status, purchase_date, notes, invoice_file_path, invoice_file_name, invoice_file_type, created_at, updated_at, supplier_id) FROM stdin;
1	Amazon					35.00	0.00	0.00	received	2026-04-16	Dodge caravan 	\N	\N	\N	2026-04-18 22:15:44.679702	2026-04-18 22:15:44.679702	1
\.


--
-- Data for Name: reminders; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.reminders (id, customer_id, vehicle_id, service_type, due_date, due_mileage, sent, sent_at, notes, created_at, updated_at) FROM stdin;
1	1	1	Oil Change	2026-04-30	65000	f	\N	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
2	3	4	Tire Rotation	2026-04-15	46000	f	\N	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
3	4	5	Annual Inspection	2026-03-26	93000	f	\N	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
4	2	2	Brake Fluid Flush	2026-05-30	35000	t	\N	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
5	6	9	Brake Inspection	2027-05-05	\N	f	\N	Auto-created from repair order RO-1011	2026-05-05 01:29:47.846011	2026-05-05 01:29:47.846011
\.


--
-- Data for Name: repair_order_events; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.repair_order_events (id, repair_order_id, event_type, actor_id, actor_label, payload, occurred_at) FROM stdin;
\.


--
-- Data for Name: repair_order_work_items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.repair_order_work_items (id, repair_order_id, source_estimate_item_id, "position", kind, description, quantity, unit_price, unit_cost, estimated_hours, status, authorized_at, performed_at, performed_by_id, voided_at, void_reason, created_at) FROM stdin;
\.


--
-- Data for Name: repair_orders; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.repair_orders (id, order_number, customer_id, vehicle_id, used_car_id, internal, assigned_to_id, created_by_id, status, priority, complaint, diagnosis, notes, mileage_in, mileage_out, promised_at, opened_at, completed_at, cancelled_at, cancellation_reason, version, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.role_permissions (id, role, resource, action) FROM stdin;
1	admin	dashboard	view
2	admin	dashboard	create
3	admin	dashboard	edit
4	admin	dashboard	delete
5	admin	dashboard	print
6	admin	repair_orders	view
7	admin	repair_orders	create
8	admin	repair_orders	edit
9	admin	repair_orders	delete
10	admin	repair_orders	print
11	admin	estimates	view
12	admin	estimates	create
13	admin	estimates	edit
14	admin	estimates	delete
15	admin	estimates	print
16	admin	invoices	view
17	admin	invoices	create
18	admin	invoices	edit
19	admin	invoices	delete
20	admin	invoices	print
21	admin	appointments	view
22	admin	appointments	create
23	admin	appointments	edit
24	admin	appointments	delete
25	admin	appointments	print
26	admin	inspections	view
27	admin	inspections	create
28	admin	inspections	edit
29	admin	inspections	delete
30	admin	inspections	print
31	admin	njmvc	view
32	admin	njmvc	create
33	admin	njmvc	edit
34	admin	njmvc	delete
35	admin	njmvc	print
36	admin	njmvc_template	view
37	admin	njmvc_template	create
38	admin	njmvc_template	edit
39	admin	njmvc_template	delete
40	admin	njmvc_template	print
41	admin	customers	view
42	admin	customers	create
43	admin	customers	edit
44	admin	customers	delete
45	admin	customers	print
46	admin	vehicles	view
47	admin	vehicles	create
48	admin	vehicles	edit
49	admin	vehicles	delete
50	admin	vehicles	print
51	admin	inventory	view
52	admin	inventory	create
53	admin	inventory	edit
54	admin	inventory	delete
55	admin	inventory	print
56	admin	payments	view
57	admin	payments	create
58	admin	payments	edit
59	admin	payments	delete
60	admin	payments	print
61	admin	used_cars	view
62	admin	used_cars	create
63	admin	used_cars	edit
64	admin	used_cars	delete
65	admin	used_cars	print
66	admin	purchases	view
67	admin	purchases	create
68	admin	purchases	edit
69	admin	purchases	delete
70	admin	purchases	print
71	admin	reports	view
72	admin	reports	create
73	admin	reports	edit
74	admin	reports	delete
75	admin	reports	print
76	admin	employees	view
77	admin	employees	create
78	admin	employees	edit
79	admin	employees	delete
80	admin	employees	print
81	admin	time_entries	view
82	admin	time_entries	create
83	admin	time_entries	edit
84	admin	time_entries	delete
85	admin	time_entries	print
86	admin	expenses	view
87	admin	expenses	create
88	admin	expenses	edit
89	admin	expenses	delete
90	admin	expenses	print
91	admin	reminders	view
92	admin	reminders	create
93	admin	reminders	edit
94	admin	reminders	delete
95	admin	reminders	print
96	admin	customer_categories	view
97	admin	customer_categories	create
98	admin	customer_categories	edit
99	admin	customer_categories	delete
100	admin	customer_categories	print
101	admin	users	view
102	admin	users	create
103	admin	users	edit
104	admin	users	delete
105	admin	users	print
106	admin	permissions	view
107	admin	permissions	create
108	admin	permissions	edit
109	admin	permissions	delete
110	admin	permissions	print
111	manager	dashboard	view
112	manager	repair_orders	view
113	manager	repair_orders	create
114	manager	repair_orders	edit
115	manager	repair_orders	delete
116	manager	repair_orders	print
117	manager	estimates	view
118	manager	estimates	create
119	manager	estimates	edit
120	manager	estimates	delete
121	manager	estimates	print
122	manager	invoices	view
123	manager	invoices	create
124	manager	invoices	edit
125	manager	invoices	delete
126	manager	invoices	print
127	manager	appointments	view
128	manager	appointments	create
129	manager	appointments	edit
130	manager	appointments	delete
131	manager	appointments	print
132	manager	inspections	view
133	manager	inspections	create
134	manager	inspections	edit
135	manager	inspections	delete
136	manager	inspections	print
137	manager	njmvc	view
138	manager	njmvc	create
139	manager	njmvc	edit
140	manager	njmvc	delete
141	manager	njmvc	print
142	manager	njmvc_template	view
143	manager	njmvc_template	edit
144	manager	customers	view
145	manager	customers	create
146	manager	customers	edit
147	manager	customers	delete
148	manager	customers	print
149	manager	vehicles	view
150	manager	vehicles	create
151	manager	vehicles	edit
152	manager	vehicles	delete
153	manager	vehicles	print
154	manager	inventory	view
155	manager	inventory	create
156	manager	inventory	edit
157	manager	inventory	delete
158	manager	inventory	print
159	manager	payments	view
160	manager	payments	create
161	manager	payments	edit
162	manager	payments	delete
163	manager	payments	print
164	manager	used_cars	view
165	manager	used_cars	create
166	manager	used_cars	edit
167	manager	used_cars	delete
168	manager	used_cars	print
169	manager	purchases	view
170	manager	purchases	create
171	manager	purchases	edit
172	manager	purchases	delete
173	manager	purchases	print
174	manager	reports	view
175	manager	reports	print
176	manager	employees	view
177	manager	employees	create
178	manager	employees	edit
179	manager	time_entries	view
180	manager	time_entries	create
181	manager	time_entries	edit
182	manager	expenses	view
183	manager	expenses	create
184	manager	expenses	edit
185	manager	reminders	view
186	manager	reminders	create
187	manager	reminders	edit
188	manager	customer_categories	view
189	manager	customer_categories	create
190	manager	customer_categories	edit
191	manager	users	view
192	manager	permissions	view
193	technician	dashboard	view
194	technician	repair_orders	view
195	technician	repair_orders	create
196	technician	repair_orders	edit
197	technician	repair_orders	print
198	technician	estimates	view
199	technician	invoices	view
200	technician	appointments	view
201	technician	inspections	view
202	technician	inspections	create
203	technician	inspections	edit
204	technician	njmvc	view
205	technician	njmvc	create
206	technician	njmvc	edit
207	technician	njmvc	print
208	technician	njmvc_template	view
209	technician	customers	view
210	technician	vehicles	view
211	technician	inventory	view
212	technician	inventory	edit
213	technician	time_entries	view
214	technician	time_entries	create
215	technician	time_entries	edit
216	technician	expenses	view
217	technician	reminders	view
218	inspector	dashboard	view
219	inspector	repair_orders	view
220	inspector	appointments	view
221	inspector	inspections	view
222	inspector	inspections	create
223	inspector	inspections	edit
224	inspector	inspections	print
225	inspector	njmvc	view
226	inspector	njmvc	create
227	inspector	njmvc	edit
228	inspector	njmvc	print
229	inspector	njmvc_template	view
230	inspector	customers	view
231	inspector	vehicles	view
232	inspector	time_entries	view
233	inspector	time_entries	edit
234	inspector	reminders	view
235	viewer	dashboard	view
236	viewer	repair_orders	view
237	viewer	estimates	view
238	viewer	invoices	view
239	viewer	appointments	view
240	viewer	inspections	view
241	viewer	njmvc	view
242	viewer	customers	view
243	viewer	vehicles	view
244	viewer	inventory	view
245	viewer	reminders	view
246	admin	canned_jobs	view
247	admin	canned_jobs	create
248	admin	canned_jobs	edit
249	admin	canned_jobs	delete
250	admin	canned_jobs	print
251	manager	canned_jobs	view
252	manager	canned_jobs	create
253	manager	canned_jobs	edit
254	manager	canned_jobs	delete
255	manager	canned_jobs	print
256	technician	canned_jobs	view
257	inspector	canned_jobs	view
258	viewer	canned_jobs	view
259	advisor	estimates	create
\.


--
-- Data for Name: shop_settings; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.shop_settings (id, labor_rate, updated_at, stripe_publishable_key, stripe_secret_key, stripe_webhook_secret, stripe_ach_enabled, twilio_account_sid, twilio_auth_token, twilio_from_number) FROM stdin;
1	95.00	2026-05-03 08:57:42.763	\N	\N	\N	f	AC_TEST_SID	fake-token-12345	+15555550100
\.


--
-- Data for Name: square_mappings; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.square_mappings (id, entity_type, local_id, square_id, square_version, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: square_sync_states; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.square_sync_states (id, resource, cursor, last_synced_at, last_error, updated_at) FROM stdin;
\.


--
-- Data for Name: square_webhook_events; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.square_webhook_events (id, square_event_id, event_type, payload, processed_at, failure_reason, received_at) FROM stdin;
\.


--
-- Data for Name: stock_movements; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.stock_movements (id, inventory_id, delta, reason, reference_table, reference_id, reference_line_id, unit_cost, notes, created_at, created_by_id, work_item_id) FROM stdin;
1	11	-1	ro_consumed	repair_orders	11	0	20.00	\N	2026-05-05 01:29:47.803437	\N	\N
2	11	1	ro_unconsumed	repair_orders	11	0	20.00	\N	2026-07-04 17:20:24.931681	\N	\N
\.


--
-- Data for Name: suppliers; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.suppliers (id, name, account_number, payment_terms, contact_name, contact_email, contact_phone, address, notes, archived, created_at, updated_at) FROM stdin;
1	Amazon	\N	\N				\N	\N	f	2026-05-03 12:15:28.257825	2026-05-03 12:15:28.257825
3	Acme-rw70kZ	AC-100	\N	\N	x@x.test	\N	123 Main St	\N	f	2026-05-03 12:29:26.022061	2026-05-03 12:30:01.03
\.


--
-- Data for Name: time_entries; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.time_entries (id, employee_id, repair_order_id, work_item_id, clock_in, clock_out, total_hours, notes, created_at) FROM stdin;
\.


--
-- Data for Name: used_cars; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.used_cars (id, vin, year, make, model, "trim", color, mileage, condition, purchase_price, selling_price, status, customer_id, purchase_date, sale_date, notes, created_at, updated_at, engine_type, transmission_type, buyer_id, sale_invoice_id, published) FROM stdin;
1		2023	Dodge 	Caravan 			\N	good	2000.00	\N	needs_work	\N	\N	\N	Transmission 	2026-05-28 04:06:35.907096	2026-05-28 04:06:35.907096			\N	\N	f
\.


--
-- Data for Name: user_board_preferences; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.user_board_preferences (id, user_id, board_key, column_order, hidden_columns, updated_at) FROM stdin;
\.


--
-- Data for Name: vehicles; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.vehicles (id, customer_id, vin, license_plate, year, make, model, "trim", color, mileage, engine_type, transmission_type, notes, created_at, updated_at, fleet_number) FROM stdin;
1	1	1HGCM82633A004352	KXP-4521	2019	Honda	Accord	EX-L	Silver	62400	V6 3.5L	Automatic	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N
2	2	2T1BURHE0JC078901	RMQ-7733	2021	Toyota	Camry	SE	White	31200	I4 2.5L	Automatic	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N
3	2	3VWFE21C04M000001	BKL-1122	2018	Volkswagen	Jetta	S	Black	78900	I4 1.4L Turbo	Automatic	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N
4	3	1G1ZT53806F109149	TNF-9901	2020	Chevrolet	Malibu	LT	Blue	44100	I4 1.5L Turbo	Automatic	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N
5	4	JHMCG56631C001234	PMD-3388	2017	Honda	Civic	LX	Red	91200	I4 1.5L	CVT	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N
6	5	1FA6P8AM1F5388888	AXR-7654	2022	Ford	Mustang	GT	Gray	18300	V8 5.0L	Manual	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N
9	6	\N	BUS-99	2018	Bluebird	Vision	\N	\N	\N	\N	\N	\N	2026-05-02 22:17:56.435571	2026-05-02 22:17:56.435571	\N
\.


--
-- Name: activity_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.activity_events_id_seq', 16, true);


--
-- Name: appointments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.appointments_id_seq', 7, true);


--
-- Name: attachments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.attachments_id_seq', 5, true);


--
-- Name: canned_jobs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.canned_jobs_id_seq', 1, true);


--
-- Name: customer_categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.customer_categories_id_seq', 1, true);


--
-- Name: customers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.customers_id_seq', 22, true);


--
-- Name: email_templates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.email_templates_id_seq', 9, true);


--
-- Name: employees_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.employees_id_seq', 22, true);


--
-- Name: estimate_approval_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.estimate_approval_items_id_seq', 35, true);


--
-- Name: estimate_approvals_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.estimate_approvals_id_seq', 22, true);


--
-- Name: estimate_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.estimate_items_id_seq', 48, true);


--
-- Name: estimate_revisions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.estimate_revisions_id_seq', 32, true);


--
-- Name: expenses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.expenses_id_seq', 5, true);


--
-- Name: idempotency_keys_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.idempotency_keys_id_seq', 14, true);


--
-- Name: inspections_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.inspections_id_seq', 3, true);


--
-- Name: inventory_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.inventory_id_seq', 11, true);


--
-- Name: invoice_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.invoice_items_id_seq', 26, true);


--
-- Name: invoices_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.invoices_id_seq', 13, true);


--
-- Name: messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.messages_id_seq', 1, false);


--
-- Name: njmvc_categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.njmvc_categories_id_seq', 20, true);


--
-- Name: njmvc_inspection_results_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.njmvc_inspection_results_id_seq', 282, true);


--
-- Name: njmvc_inspections_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.njmvc_inspections_id_seq', 2, true);


--
-- Name: njmvc_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.njmvc_items_id_seq', 94, true);


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.password_reset_tokens_id_seq', 3, true);


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.payments_id_seq', 23, true);


--
-- Name: processor_webhook_receipts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.processor_webhook_receipts_id_seq', 1, false);


--
-- Name: purchase_line_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.purchase_line_items_id_seq', 1, true);


--
-- Name: purchases_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.purchases_id_seq', 1, true);


--
-- Name: reminders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.reminders_id_seq', 5, true);


--
-- Name: repair_order_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.repair_order_events_id_seq', 268, true);


--
-- Name: repair_order_work_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.repair_order_work_items_id_seq', 29, true);


--
-- Name: repair_orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.repair_orders_id_seq', 39, true);


--
-- Name: role_permissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.role_permissions_id_seq', 261, true);


--
-- Name: shop_settings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.shop_settings_id_seq', 1, true);


--
-- Name: square_mappings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.square_mappings_id_seq', 1, false);


--
-- Name: square_sync_states_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.square_sync_states_id_seq', 1, false);


--
-- Name: square_webhook_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.square_webhook_events_id_seq', 1, false);


--
-- Name: stock_movements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.stock_movements_id_seq', 2, true);


--
-- Name: suppliers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.suppliers_id_seq', 3, true);


--
-- Name: time_entries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.time_entries_id_seq', 1, false);


--
-- Name: used_cars_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.used_cars_id_seq', 1, true);


--
-- Name: user_board_preferences_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.user_board_preferences_id_seq', 1, false);


--
-- Name: vehicles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.vehicles_id_seq', 18, true);


--
-- Name: activity_events activity_events_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.activity_events
    ADD CONSTRAINT activity_events_pkey PRIMARY KEY (id);


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);


--
-- Name: canned_jobs canned_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.canned_jobs
    ADD CONSTRAINT canned_jobs_pkey PRIMARY KEY (id);


--
-- Name: customer_categories customer_categories_name_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.customer_categories
    ADD CONSTRAINT customer_categories_name_unique UNIQUE (name);


--
-- Name: customer_categories customer_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.customer_categories
    ADD CONSTRAINT customer_categories_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: email_templates email_templates_key_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_key_unique UNIQUE (key);


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: employees employees_username_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_username_unique UNIQUE (username);


--
-- Name: estimate_approval_items estimate_approval_items_approval_id_estimate_item_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approval_items
    ADD CONSTRAINT estimate_approval_items_approval_id_estimate_item_id_key UNIQUE (approval_id, estimate_item_id);


--
-- Name: estimate_approval_items estimate_approval_items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approval_items
    ADD CONSTRAINT estimate_approval_items_pkey PRIMARY KEY (id);


--
-- Name: estimate_approvals estimate_approvals_estimate_revision_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approvals
    ADD CONSTRAINT estimate_approvals_estimate_revision_id_key UNIQUE (estimate_revision_id);


--
-- Name: estimate_approvals estimate_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approvals
    ADD CONSTRAINT estimate_approvals_pkey PRIMARY KEY (id);


--
-- Name: estimate_items estimate_items_estimate_revision_id_position_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_items
    ADD CONSTRAINT estimate_items_estimate_revision_id_position_key UNIQUE (estimate_revision_id, "position");


--
-- Name: estimate_items estimate_items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_items
    ADD CONSTRAINT estimate_items_pkey PRIMARY KEY (id);


--
-- Name: estimate_revisions estimate_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_revisions
    ADD CONSTRAINT estimate_revisions_pkey PRIMARY KEY (id);


--
-- Name: estimate_revisions estimate_revisions_public_token_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_revisions
    ADD CONSTRAINT estimate_revisions_public_token_key UNIQUE (public_token);


--
-- Name: estimate_revisions estimate_revisions_repair_order_id_revision_no_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_revisions
    ADD CONSTRAINT estimate_revisions_repair_order_id_revision_no_key UNIQUE (repair_order_id, revision_no);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (id);


--
-- Name: idempotency_keys idempotency_keys_scope_key_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_scope_key_key UNIQUE (scope, key);


--
-- Name: inspections inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_pkey PRIMARY KEY (id);


--
-- Name: inventory inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);


--
-- Name: invoice_items invoice_items_invoice_id_position_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_position_key UNIQUE (invoice_id, "position");


--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


--
-- Name: invoice_items invoice_items_source_work_item_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_source_work_item_id_key UNIQUE (source_work_item_id);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_public_token_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_public_token_key UNIQUE (public_token);


--
-- Name: invoices invoices_repair_order_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_repair_order_id_key UNIQUE (repair_order_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: njmvc_categories njmvc_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_categories
    ADD CONSTRAINT njmvc_categories_pkey PRIMARY KEY (id);


--
-- Name: njmvc_inspection_results njmvc_inspection_results_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_inspection_results
    ADD CONSTRAINT njmvc_inspection_results_pkey PRIMARY KEY (id);


--
-- Name: njmvc_inspections njmvc_inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_inspections
    ADD CONSTRAINT njmvc_inspections_pkey PRIMARY KEY (id);


--
-- Name: njmvc_items njmvc_items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_items
    ADD CONSTRAINT njmvc_items_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: payments payments_invoice_id_attempt_key_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_attempt_key_key UNIQUE (invoice_id, attempt_key);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: processor_webhook_receipts processor_webhook_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.processor_webhook_receipts
    ADD CONSTRAINT processor_webhook_receipts_pkey PRIMARY KEY (id);


--
-- Name: processor_webhook_receipts processor_webhook_receipts_processor_event_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.processor_webhook_receipts
    ADD CONSTRAINT processor_webhook_receipts_processor_event_id_key UNIQUE (processor, event_id);


--
-- Name: purchase_line_items purchase_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchase_line_items
    ADD CONSTRAINT purchase_line_items_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: reminders reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);


--
-- Name: repair_order_events repair_order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_events
    ADD CONSTRAINT repair_order_events_pkey PRIMARY KEY (id);


--
-- Name: repair_order_work_items repair_order_work_items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_work_items
    ADD CONSTRAINT repair_order_work_items_pkey PRIMARY KEY (id);


--
-- Name: repair_order_work_items repair_order_work_items_repair_order_id_position_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_work_items
    ADD CONSTRAINT repair_order_work_items_repair_order_id_position_key UNIQUE (repair_order_id, "position");


--
-- Name: repair_order_work_items repair_order_work_items_source_estimate_item_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_work_items
    ADD CONSTRAINT repair_order_work_items_source_estimate_item_id_key UNIQUE (source_estimate_item_id);


--
-- Name: repair_orders repair_orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders
    ADD CONSTRAINT repair_orders_order_number_key UNIQUE (order_number);


--
-- Name: repair_orders repair_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders
    ADD CONSTRAINT repair_orders_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: shop_settings shop_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.shop_settings
    ADD CONSTRAINT shop_settings_pkey PRIMARY KEY (id);


--
-- Name: square_mappings square_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_mappings
    ADD CONSTRAINT square_mappings_pkey PRIMARY KEY (id);


--
-- Name: square_sync_states square_sync_states_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_sync_states
    ADD CONSTRAINT square_sync_states_pkey PRIMARY KEY (id);


--
-- Name: square_sync_states square_sync_states_resource_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_sync_states
    ADD CONSTRAINT square_sync_states_resource_key UNIQUE (resource);


--
-- Name: square_webhook_events square_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_webhook_events
    ADD CONSTRAINT square_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: square_webhook_events square_webhook_events_square_event_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_webhook_events
    ADD CONSTRAINT square_webhook_events_square_event_id_key UNIQUE (square_event_id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: time_entries time_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_pkey PRIMARY KEY (id);


--
-- Name: used_cars used_cars_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.used_cars
    ADD CONSTRAINT used_cars_pkey PRIMARY KEY (id);


--
-- Name: user_board_preferences user_board_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.user_board_preferences
    ADD CONSTRAINT user_board_preferences_pkey PRIMARY KEY (id);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- Name: activity_events_entity_cursor_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX activity_events_entity_cursor_idx ON public.activity_events USING btree (entity_type, entity_id, id);


--
-- Name: activity_events_entity_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX activity_events_entity_idx ON public.activity_events USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: attachments_owner_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX attachments_owner_idx ON public.attachments USING btree (owner_type, owner_id);


--
-- Name: customers_square_customer_id_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX customers_square_customer_id_unique ON public.customers USING btree (square_customer_id) WHERE (square_customer_id IS NOT NULL);


--
-- Name: estimate_approval_items_item_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX estimate_approval_items_item_idx ON public.estimate_approval_items USING btree (estimate_item_id);


--
-- Name: estimate_revisions_one_sent_active; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX estimate_revisions_one_sent_active ON public.estimate_revisions USING btree (repair_order_id) WHERE (status = 'sent'::public.estimate_revision_status);


--
-- Name: estimate_revisions_public_token_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX estimate_revisions_public_token_idx ON public.estimate_revisions USING btree (public_token);


--
-- Name: estimate_revisions_ro_status_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX estimate_revisions_ro_status_idx ON public.estimate_revisions USING btree (repair_order_id, status);


--
-- Name: inspections_public_token_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX inspections_public_token_idx ON public.inspections USING btree (public_token);


--
-- Name: inventory_preferred_supplier_id_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX inventory_preferred_supplier_id_idx ON public.inventory USING btree (preferred_supplier_id);


--
-- Name: inventory_square_catalog_object_id_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX inventory_square_catalog_object_id_unique ON public.inventory USING btree (square_catalog_object_id) WHERE (square_catalog_object_id IS NOT NULL);


--
-- Name: messages_customer_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX messages_customer_idx ON public.messages USING btree (customer_id, created_at);


--
-- Name: messages_inbound_unread_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX messages_inbound_unread_idx ON public.messages USING btree (direction, read_at);


--
-- Name: messages_twilio_sid_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX messages_twilio_sid_idx ON public.messages USING btree (twilio_sid);


--
-- Name: password_reset_tokens_employee_unused_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX password_reset_tokens_employee_unused_idx ON public.password_reset_tokens USING btree (employee_id, used_at);


--
-- Name: password_reset_tokens_expires_at_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX password_reset_tokens_expires_at_idx ON public.password_reset_tokens USING btree (expires_at);


--
-- Name: payments_invoice_status_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX payments_invoice_status_idx ON public.payments USING btree (invoice_id, status);


--
-- Name: payments_parent_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX payments_parent_idx ON public.payments USING btree (parent_payment_id);


--
-- Name: payments_processor_event_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX payments_processor_event_unique ON public.payments USING btree (processor, processor_event_id) WHERE (processor_event_id IS NOT NULL);


--
-- Name: payments_processor_payment_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX payments_processor_payment_unique ON public.payments USING btree (processor, processor_payment_id) WHERE (processor_payment_id IS NOT NULL);


--
-- Name: processor_webhook_receipts_pending_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX processor_webhook_receipts_pending_idx ON public.processor_webhook_receipts USING btree (processor, processed_at);


--
-- Name: purchases_supplier_id_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX purchases_supplier_id_idx ON public.purchases USING btree (supplier_id);


--
-- Name: repair_order_events_ro_occurred_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX repair_order_events_ro_occurred_idx ON public.repair_order_events USING btree (repair_order_id, occurred_at);


--
-- Name: repair_order_work_items_ro_status_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX repair_order_work_items_ro_status_idx ON public.repair_order_work_items USING btree (repair_order_id, status);


--
-- Name: repair_orders_customer_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX repair_orders_customer_idx ON public.repair_orders USING btree (customer_id);


--
-- Name: repair_orders_status_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX repair_orders_status_idx ON public.repair_orders USING btree (status);


--
-- Name: repair_orders_vehicle_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX repair_orders_vehicle_idx ON public.repair_orders USING btree (vehicle_id);


--
-- Name: role_permissions_role_resource_action_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX role_permissions_role_resource_action_idx ON public.role_permissions USING btree (role, resource, action);


--
-- Name: square_mappings_entity_local_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX square_mappings_entity_local_unique ON public.square_mappings USING btree (entity_type, local_id);


--
-- Name: square_mappings_square_id_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX square_mappings_square_id_unique ON public.square_mappings USING btree (square_id);


--
-- Name: stock_movements_inventory_id_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX stock_movements_inventory_id_idx ON public.stock_movements USING btree (inventory_id);


--
-- Name: stock_movements_reference_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX stock_movements_reference_idx ON public.stock_movements USING btree (reference_table, reference_id);


--
-- Name: stock_movements_source_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX stock_movements_source_idx ON public.stock_movements USING btree (inventory_id, reference_table, reference_id, reference_line_id, reason);


--
-- Name: stock_movements_work_item_consumption_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX stock_movements_work_item_consumption_unique ON public.stock_movements USING btree (work_item_id) WHERE ((reason = 'ro_consumed'::text) AND (work_item_id IS NOT NULL));


--
-- Name: suppliers_name_lower_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX suppliers_name_lower_unique ON public.suppliers USING btree (lower(name));


--
-- Name: user_board_preferences_user_board_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX user_board_preferences_user_board_idx ON public.user_board_preferences USING btree (user_id, board_key);


--
-- Name: estimate_approval_items estimate_approval_items_immutable; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER estimate_approval_items_immutable BEFORE DELETE OR UPDATE ON public.estimate_approval_items FOR EACH ROW EXECUTE FUNCTION public.reject_repair_domain_mutation();


--
-- Name: estimate_approvals estimate_approvals_immutable; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER estimate_approvals_immutable BEFORE DELETE OR UPDATE ON public.estimate_approvals FOR EACH ROW EXECUTE FUNCTION public.reject_repair_domain_mutation();


--
-- Name: estimate_items estimate_items_sent_immutable; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER estimate_items_sent_immutable BEFORE DELETE OR UPDATE ON public.estimate_items FOR EACH ROW EXECUTE FUNCTION public.reject_sent_estimate_item_mutation();


--
-- Name: estimate_revisions estimate_revisions_transition_guard; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER estimate_revisions_transition_guard BEFORE DELETE OR UPDATE ON public.estimate_revisions FOR EACH ROW EXECUTE FUNCTION public.enforce_estimate_revision_transition();


--
-- Name: invoice_items invoice_items_immutable; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER invoice_items_immutable BEFORE DELETE OR UPDATE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION public.reject_repair_domain_mutation();


--
-- Name: invoices invoices_transition_guard; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER invoices_transition_guard BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_transition();


--
-- Name: payments payments_transition_guard; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER payments_transition_guard BEFORE DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_transition();


--
-- Name: repair_order_events repair_order_events_append_only; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER repair_order_events_append_only BEFORE DELETE OR UPDATE ON public.repair_order_events FOR EACH ROW EXECUTE FUNCTION public.reject_repair_domain_mutation();


--
-- Name: repair_orders repair_orders_transition_guard; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER repair_orders_transition_guard BEFORE UPDATE ON public.repair_orders FOR EACH ROW EXECUTE FUNCTION public.enforce_repair_order_transition();


--
-- Name: activity_events activity_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.activity_events
    ADD CONSTRAINT activity_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_assigned_to_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_assigned_to_id_employees_id_fk FOREIGN KEY (assigned_to_id) REFERENCES public.employees(id);


--
-- Name: appointments appointments_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: appointments appointments_vehicle_id_vehicles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_vehicle_id_vehicles_id_fk FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: attachments attachments_uploaded_by_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_uploaded_by_id_employees_id_fk FOREIGN KEY (uploaded_by_id) REFERENCES public.employees(id);


--
-- Name: customers customers_category_id_customer_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_category_id_customer_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.customer_categories(id);


--
-- Name: estimate_approval_items estimate_approval_items_approval_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approval_items
    ADD CONSTRAINT estimate_approval_items_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES public.estimate_approvals(id) ON DELETE RESTRICT;


--
-- Name: estimate_approval_items estimate_approval_items_estimate_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approval_items
    ADD CONSTRAINT estimate_approval_items_estimate_item_id_fkey FOREIGN KEY (estimate_item_id) REFERENCES public.estimate_items(id) ON DELETE RESTRICT;


--
-- Name: estimate_approvals estimate_approvals_estimate_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approvals
    ADD CONSTRAINT estimate_approvals_estimate_revision_id_fkey FOREIGN KEY (estimate_revision_id) REFERENCES public.estimate_revisions(id) ON DELETE RESTRICT;


--
-- Name: estimate_items estimate_items_estimate_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_items
    ADD CONSTRAINT estimate_items_estimate_revision_id_fkey FOREIGN KEY (estimate_revision_id) REFERENCES public.estimate_revisions(id) ON DELETE CASCADE;


--
-- Name: estimate_items estimate_items_inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_items
    ADD CONSTRAINT estimate_items_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory(id) ON DELETE SET NULL;


--
-- Name: estimate_revisions estimate_revisions_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_revisions
    ADD CONSTRAINT estimate_revisions_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.employees(id);


--
-- Name: estimate_revisions estimate_revisions_repair_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_revisions
    ADD CONSTRAINT estimate_revisions_repair_order_id_fkey FOREIGN KEY (repair_order_id) REFERENCES public.repair_orders(id) ON DELETE CASCADE;


--
-- Name: inspections inspections_inspected_by_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_inspected_by_id_employees_id_fk FOREIGN KEY (inspected_by_id) REFERENCES public.employees(id);


--
-- Name: inspections inspections_repair_order_id_repair_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_repair_order_id_repair_orders_id_fk FOREIGN KEY (repair_order_id) REFERENCES public.repair_orders(id);


--
-- Name: inspections inspections_vehicle_id_vehicles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_vehicle_id_vehicles_id_fk FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: inventory inventory_preferred_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_preferred_supplier_id_fkey FOREIGN KEY (preferred_supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: invoice_items invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_items invoice_items_source_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_source_work_item_id_fkey FOREIGN KEY (source_work_item_id) REFERENCES public.repair_order_work_items(id) ON DELETE RESTRICT;


--
-- Name: invoices invoices_issued_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_issued_by_id_fkey FOREIGN KEY (issued_by_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_repair_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_repair_order_id_fkey FOREIGN KEY (repair_order_id) REFERENCES public.repair_orders(id) ON DELETE RESTRICT;


--
-- Name: invoices invoices_voided_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_voided_by_id_fkey FOREIGN KEY (voided_by_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: messages messages_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: messages messages_estimate_id_estimate_revisions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_estimate_id_estimate_revisions_id_fk FOREIGN KEY (estimate_id) REFERENCES public.estimate_revisions(id) ON DELETE SET NULL;


--
-- Name: messages messages_invoice_id_invoices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_invoice_id_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: messages messages_repair_order_id_repair_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_repair_order_id_repair_orders_id_fk FOREIGN KEY (repair_order_id) REFERENCES public.repair_orders(id) ON DELETE SET NULL;


--
-- Name: njmvc_inspection_results njmvc_inspection_results_inspection_id_njmvc_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_inspection_results
    ADD CONSTRAINT njmvc_inspection_results_inspection_id_njmvc_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.njmvc_inspections(id) ON DELETE CASCADE;


--
-- Name: njmvc_inspection_results njmvc_inspection_results_item_id_njmvc_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_inspection_results
    ADD CONSTRAINT njmvc_inspection_results_item_id_njmvc_items_id_fk FOREIGN KEY (item_id) REFERENCES public.njmvc_items(id) ON DELETE RESTRICT;


--
-- Name: njmvc_inspections njmvc_inspections_vehicle_id_vehicles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_inspections
    ADD CONSTRAINT njmvc_inspections_vehicle_id_vehicles_id_fk FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: njmvc_items njmvc_items_category_id_njmvc_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_items
    ADD CONSTRAINT njmvc_items_category_id_njmvc_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.njmvc_categories(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: payments payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE RESTRICT;


--
-- Name: payments payments_parent_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_parent_payment_id_fkey FOREIGN KEY (parent_payment_id) REFERENCES public.payments(id) ON DELETE RESTRICT;


--
-- Name: purchase_line_items purchase_line_items_inventory_id_inventory_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchase_line_items
    ADD CONSTRAINT purchase_line_items_inventory_id_inventory_id_fk FOREIGN KEY (inventory_id) REFERENCES public.inventory(id);


--
-- Name: purchase_line_items purchase_line_items_purchase_id_purchases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchase_line_items
    ADD CONSTRAINT purchase_line_items_purchase_id_purchases_id_fk FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE CASCADE;


--
-- Name: purchase_line_items purchase_line_items_used_car_id_used_cars_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchase_line_items
    ADD CONSTRAINT purchase_line_items_used_car_id_used_cars_id_fk FOREIGN KEY (used_car_id) REFERENCES public.used_cars(id);


--
-- Name: purchases purchases_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: reminders reminders_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: reminders reminders_vehicle_id_vehicles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_vehicle_id_vehicles_id_fk FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: repair_order_events repair_order_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_events
    ADD CONSTRAINT repair_order_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: repair_order_events repair_order_events_repair_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_events
    ADD CONSTRAINT repair_order_events_repair_order_id_fkey FOREIGN KEY (repair_order_id) REFERENCES public.repair_orders(id) ON DELETE CASCADE;


--
-- Name: repair_order_work_items repair_order_work_items_performed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_work_items
    ADD CONSTRAINT repair_order_work_items_performed_by_id_fkey FOREIGN KEY (performed_by_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: repair_order_work_items repair_order_work_items_repair_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_work_items
    ADD CONSTRAINT repair_order_work_items_repair_order_id_fkey FOREIGN KEY (repair_order_id) REFERENCES public.repair_orders(id) ON DELETE CASCADE;


--
-- Name: repair_order_work_items repair_order_work_items_source_estimate_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_work_items
    ADD CONSTRAINT repair_order_work_items_source_estimate_item_id_fkey FOREIGN KEY (source_estimate_item_id) REFERENCES public.estimate_items(id) ON DELETE RESTRICT;


--
-- Name: repair_orders repair_orders_assigned_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders
    ADD CONSTRAINT repair_orders_assigned_to_id_fkey FOREIGN KEY (assigned_to_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: repair_orders repair_orders_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders
    ADD CONSTRAINT repair_orders_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.employees(id);


--
-- Name: repair_orders repair_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders
    ADD CONSTRAINT repair_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: repair_orders repair_orders_used_car_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders
    ADD CONSTRAINT repair_orders_used_car_id_fkey FOREIGN KEY (used_car_id) REFERENCES public.used_cars(id) ON DELETE SET NULL;


--
-- Name: repair_orders repair_orders_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders
    ADD CONSTRAINT repair_orders_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: stock_movements stock_movements_inventory_id_inventory_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_inventory_id_inventory_id_fk FOREIGN KEY (inventory_id) REFERENCES public.inventory(id) ON DELETE CASCADE;


--
-- Name: stock_movements stock_movements_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.repair_order_work_items(id);


--
-- Name: time_entries time_entries_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: time_entries time_entries_repair_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_repair_order_id_fkey FOREIGN KEY (repair_order_id) REFERENCES public.repair_orders(id);


--
-- Name: time_entries time_entries_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.repair_order_work_items(id);


--
-- Name: used_cars used_cars_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.used_cars
    ADD CONSTRAINT used_cars_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.customers(id);


--
-- Name: used_cars used_cars_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.used_cars
    ADD CONSTRAINT used_cars_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: user_board_preferences user_board_preferences_user_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.user_board_preferences
    ADD CONSTRAINT user_board_preferences_user_id_employees_id_fk FOREIGN KEY (user_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: vehicles vehicles_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO neon_superuser WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON TABLES TO neon_superuser WITH GRANT OPTION;


--
-- PostgreSQL database dump complete
--

\unrestrict hxRlSU8roGhc2bS98Dj5HP5HjP67RLqxet0B5MrHPtKWKLXFJyGynrdZP3QGH4P

--
-- PostgreSQL database dump
--

\restrict hxRlSU8roGhc2bS98Dj5HP5HjP67RLqxet0B5MrHPtKWKLXFJyGynrdZP3QGH4P

-- Dumped from database version 16.15 (ef25dd3)
-- Dumped by pg_dump version 16.10

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: estimate_approval_decision; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.estimate_approval_decision AS ENUM (
    'approved',
    'partially_approved',
    'declined'
);


ALTER TYPE public.estimate_approval_decision OWNER TO neondb_owner;

--
-- Name: estimate_approval_item_decision; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.estimate_approval_item_decision AS ENUM (
    'approved',
    'declined'
);


ALTER TYPE public.estimate_approval_item_decision OWNER TO neondb_owner;

--
-- Name: estimate_item_kind; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.estimate_item_kind AS ENUM (
    'part',
    'labor',
    'fee',
    'discount'
);


ALTER TYPE public.estimate_item_kind OWNER TO neondb_owner;

--
-- Name: estimate_revision_kind; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.estimate_revision_kind AS ENUM (
    'estimate',
    'supplement'
);


ALTER TYPE public.estimate_revision_kind OWNER TO neondb_owner;

--
-- Name: estimate_revision_status; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.estimate_revision_status AS ENUM (
    'draft',
    'sent',
    'approved',
    'partially_approved',
    'declined',
    'superseded'
);


ALTER TYPE public.estimate_revision_status OWNER TO neondb_owner;

--
-- Name: invoice_status; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.invoice_status AS ENUM (
    'draft',
    'issued',
    'partially_paid',
    'paid',
    'void'
);


ALTER TYPE public.invoice_status OWNER TO neondb_owner;

--
-- Name: payment_status; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.payment_status AS ENUM (
    'pending',
    'succeeded',
    'failed',
    'refunded',
    'void'
);


ALTER TYPE public.payment_status OWNER TO neondb_owner;

--
-- Name: repair_order_event_type; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.repair_order_event_type AS ENUM (
    'opened',
    'status_changed',
    'assigned',
    'estimate_created',
    'estimate_sent',
    'estimate_decided',
    'supplement_created',
    'supplement_sent',
    'supplement_decided',
    'work_authorized',
    'work_performed',
    'invoice_created',
    'invoice_issued',
    'invoice_voided',
    'payment_recorded',
    'payment_failed',
    'payment_refunded',
    'payment_voided',
    'ro_completed',
    'cancelled',
    'note_added'
);


ALTER TYPE public.repair_order_event_type OWNER TO neondb_owner;

--
-- Name: repair_order_priority; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.repair_order_priority AS ENUM (
    'low',
    'normal',
    'high',
    'urgent'
);


ALTER TYPE public.repair_order_priority OWNER TO neondb_owner;

--
-- Name: repair_order_status; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.repair_order_status AS ENUM (
    'open',
    'diagnosing',
    'awaiting_approval',
    'authorized',
    'in_progress',
    'completed',
    'cancelled'
);


ALTER TYPE public.repair_order_status OWNER TO neondb_owner;

--
-- Name: repair_order_work_item_status; Type: TYPE; Schema: public; Owner: neondb_owner
--

CREATE TYPE public.repair_order_work_item_status AS ENUM (
    'authorized',
    'performed',
    'void'
);


ALTER TYPE public.repair_order_work_item_status OWNER TO neondb_owner;

--
-- Name: enforce_estimate_revision_transition(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.enforce_estimate_revision_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.sent_at IS NOT NULL THEN RAISE EXCEPTION 'sent estimate revisions cannot be deleted'; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'sent' THEN
    IF NEW.status NOT IN ('approved','partially_approved','declined','superseded')
       OR (to_jsonb(NEW) - ARRAY['status','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','updated_at']) THEN
      RAISE EXCEPTION 'only a sent estimate lifecycle transition is allowed';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status IN ('approved','partially_approved','declined','superseded') THEN
    RAISE EXCEPTION 'final estimate revision is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;


ALTER FUNCTION public.enforce_estimate_revision_transition() OWNER TO neondb_owner;

--
-- Name: enforce_invoice_transition(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.enforce_invoice_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status = 'void' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'final invoice is immutable';
  END IF;
  IF OLD.status <> 'draft' AND
     (to_jsonb(NEW) - ARRAY['amount_paid','balance','status','version','updated_at','voided_at','voided_by_id','void_reason'])
       IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['amount_paid','balance','status','version','updated_at','voided_at','voided_by_id','void_reason']) THEN
    RAISE EXCEPTION 'issued invoice commercial fields are immutable';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status IN ('issued','void')) OR
    (OLD.status = 'issued' AND NEW.status IN ('partially_paid','paid','void')) OR
    (OLD.status = 'partially_paid' AND NEW.status IN ('issued','paid','void')) OR
    (OLD.status = 'paid' AND NEW.status IN ('issued','partially_paid'))
  ) THEN RAISE EXCEPTION 'invalid invoice status transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.enforce_invoice_transition() OWNER TO neondb_owner;

--
-- Name: enforce_payment_transition(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.enforce_payment_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payments cannot be deleted'; END IF;
  IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'final payment entries are immutable'; END IF;
  IF NEW.status NOT IN ('succeeded','failed','void')
     OR (to_jsonb(NEW) - ARRAY['status','processor','processor_payment_id','processor_event_id','failure_reason','voided_at','processed_at'])
       IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['status','processor','processor_payment_id','processor_event_id','failure_reason','voided_at','processed_at']) THEN
    RAISE EXCEPTION 'only a pending payment result transition is allowed';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.enforce_payment_transition() OWNER TO neondb_owner;

--
-- Name: enforce_repair_order_transition(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.enforce_repair_order_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF OLD.status IN ('completed','cancelled') THEN
    IF NEW.status <> OLD.status OR
       (to_jsonb(NEW) - ARRAY['notes','updated_at','version']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['notes','updated_at','version']) THEN
      RAISE EXCEPTION 'terminal repair order is immutable';
    END IF;
  ELSIF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'open' AND NEW.status IN ('diagnosing','awaiting_approval','authorized','cancelled')) OR
    (OLD.status = 'diagnosing' AND NEW.status IN ('awaiting_approval','authorized','cancelled')) OR
    (OLD.status = 'awaiting_approval' AND NEW.status IN ('authorized','in_progress','diagnosing','cancelled')) OR
    (OLD.status = 'authorized' AND NEW.status IN ('in_progress','awaiting_approval','cancelled')) OR
    (OLD.status = 'in_progress' AND NEW.status IN ('completed','authorized','awaiting_approval','cancelled'))
  ) THEN RAISE EXCEPTION 'invalid repair order status transition: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.enforce_repair_order_transition() OWNER TO neondb_owner;

--
-- Name: reject_repair_domain_mutation(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.reject_repair_domain_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN RAISE EXCEPTION '% is immutable', TG_TABLE_NAME; END $$;


ALTER FUNCTION public.reject_repair_domain_mutation() OWNER TO neondb_owner;

--
-- Name: reject_sent_estimate_item_mutation(); Type: FUNCTION; Schema: public; Owner: neondb_owner
--

CREATE FUNCTION public.reject_sent_estimate_item_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM estimate_revisions WHERE id = OLD.estimate_revision_id AND sent_at IS NOT NULL) THEN
    RAISE EXCEPTION 'items on sent estimate revisions are immutable';
  END IF;
  RETURN NEW;
END $$;


ALTER FUNCTION public.reject_sent_estimate_item_mutation() OWNER TO neondb_owner;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: activity_events; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.activity_events (
    id integer NOT NULL,
    entity_type text NOT NULL,
    entity_id integer NOT NULL,
    event_type text NOT NULL,
    actor_id integer,
    actor_label text,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.activity_events OWNER TO neondb_owner;

--
-- Name: activity_events_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.activity_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.activity_events_id_seq OWNER TO neondb_owner;

--
-- Name: activity_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.activity_events_id_seq OWNED BY public.activity_events.id;


--
-- Name: appointments; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.appointments (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    vehicle_id integer,
    assigned_to_id integer,
    status text DEFAULT 'scheduled'::text NOT NULL,
    service_type text NOT NULL,
    description text,
    scheduled_at timestamp without time zone NOT NULL,
    estimated_duration integer,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.appointments OWNER TO neondb_owner;

--
-- Name: appointments_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.appointments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.appointments_id_seq OWNER TO neondb_owner;

--
-- Name: appointments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.appointments_id_seq OWNED BY public.appointments.id;


--
-- Name: attachments; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.attachments (
    id integer NOT NULL,
    owner_type text NOT NULL,
    owner_id integer NOT NULL,
    file_name text NOT NULL,
    mime_type text NOT NULL,
    size integer NOT NULL,
    storage_path text NOT NULL,
    notes text,
    uploaded_by_id integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.attachments OWNER TO neondb_owner;

--
-- Name: attachments_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.attachments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.attachments_id_seq OWNER TO neondb_owner;

--
-- Name: attachments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.attachments_id_seq OWNED BY public.attachments.id;


--
-- Name: canned_jobs; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.canned_jobs (
    id integer NOT NULL,
    name text NOT NULL,
    category text,
    description text,
    estimated_hours numeric(10,2),
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.canned_jobs OWNER TO neondb_owner;

--
-- Name: canned_jobs_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.canned_jobs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.canned_jobs_id_seq OWNER TO neondb_owner;

--
-- Name: canned_jobs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.canned_jobs_id_seq OWNED BY public.canned_jobs.id;


--
-- Name: customer_categories; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.customer_categories (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    labor_rate numeric(10,2) DEFAULT '120'::numeric NOT NULL,
    parts_markup numeric(5,2) DEFAULT '0'::numeric NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.customer_categories OWNER TO neondb_owner;

--
-- Name: customer_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.customer_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customer_categories_id_seq OWNER TO neondb_owner;

--
-- Name: customer_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.customer_categories_id_seq OWNED BY public.customer_categories.id;


--
-- Name: customers; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.customers (
    id integer NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text,
    phone text,
    address text,
    city text,
    state text,
    zip text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    category_id integer,
    preferred_channel text DEFAULT 'email'::text NOT NULL,
    sms_opt_out text DEFAULT 'false'::text NOT NULL,
    tax_exempt boolean DEFAULT false NOT NULL,
    tax_exempt_number text,
    square_customer_id text
);


ALTER TABLE public.customers OWNER TO neondb_owner;

--
-- Name: customers_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.customers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.customers_id_seq OWNER TO neondb_owner;

--
-- Name: customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.customers_id_seq OWNED BY public.customers.id;


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.email_templates (
    id integer NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    subject text NOT NULL,
    body_html text NOT NULL,
    from_name text,
    from_email text,
    enabled text DEFAULT 'true'::text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.email_templates OWNER TO neondb_owner;

--
-- Name: email_templates_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.email_templates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.email_templates_id_seq OWNER TO neondb_owner;

--
-- Name: email_templates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.email_templates_id_seq OWNED BY public.email_templates.id;


--
-- Name: employees; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.employees (
    id integer NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text,
    phone text,
    role text DEFAULT 'technician'::text NOT NULL,
    hourly_rate numeric(10,2),
    active boolean DEFAULT true NOT NULL,
    hire_date date,
    notes text,
    clocked_in boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    roles text[] DEFAULT ARRAY[]::text[] NOT NULL,
    username text,
    password_hash text,
    last_login_at timestamp without time zone
);


ALTER TABLE public.employees OWNER TO neondb_owner;

--
-- Name: employees_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.employees_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.employees_id_seq OWNER TO neondb_owner;

--
-- Name: employees_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.employees_id_seq OWNED BY public.employees.id;


--
-- Name: estimate_approval_items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.estimate_approval_items (
    id integer NOT NULL,
    approval_id integer NOT NULL,
    estimate_item_id integer NOT NULL,
    decision public.estimate_approval_item_decision NOT NULL
);


ALTER TABLE public.estimate_approval_items OWNER TO neondb_owner;

--
-- Name: estimate_approval_items_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.estimate_approval_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.estimate_approval_items_id_seq OWNER TO neondb_owner;

--
-- Name: estimate_approval_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.estimate_approval_items_id_seq OWNED BY public.estimate_approval_items.id;


--
-- Name: estimate_approvals; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.estimate_approvals (
    id integer NOT NULL,
    estimate_revision_id integer NOT NULL,
    decision public.estimate_approval_decision NOT NULL,
    signer_name text,
    signer_email text,
    signature_url text,
    document_hash text NOT NULL,
    request_ip text,
    request_user_agent text,
    decided_at timestamp with time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.estimate_approvals OWNER TO neondb_owner;

--
-- Name: estimate_approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.estimate_approvals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.estimate_approvals_id_seq OWNER TO neondb_owner;

--
-- Name: estimate_approvals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.estimate_approvals_id_seq OWNED BY public.estimate_approvals.id;


--
-- Name: estimate_items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.estimate_items (
    id integer NOT NULL,
    estimate_revision_id integer NOT NULL,
    "position" integer NOT NULL,
    kind public.estimate_item_kind NOT NULL,
    description text NOT NULL,
    quantity numeric(14,3) DEFAULT 1 NOT NULL,
    unit_price numeric(14,2) DEFAULT 0 NOT NULL,
    unit_cost numeric(14,2),
    inventory_item_id integer,
    estimated_hours numeric(10,2),
    warranty_months integer,
    warranty_miles integer,
    CONSTRAINT estimate_items_check CHECK (((unit_price >= (0)::numeric) AND ((unit_cost IS NULL) OR (unit_cost >= (0)::numeric)) AND ((estimated_hours IS NULL) OR (estimated_hours >= (0)::numeric)))),
    CONSTRAINT estimate_items_check1 CHECK ((((warranty_months IS NULL) OR (warranty_months >= 0)) AND ((warranty_miles IS NULL) OR (warranty_miles >= 0)))),
    CONSTRAINT estimate_items_position_check CHECK (("position" > 0)),
    CONSTRAINT estimate_items_quantity_check CHECK ((quantity > (0)::numeric))
);


ALTER TABLE public.estimate_items OWNER TO neondb_owner;

--
-- Name: estimate_items_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.estimate_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.estimate_items_id_seq OWNER TO neondb_owner;

--
-- Name: estimate_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.estimate_items_id_seq OWNED BY public.estimate_items.id;


--
-- Name: estimate_revisions; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.estimate_revisions (
    id integer NOT NULL,
    repair_order_id integer NOT NULL,
    revision_no integer NOT NULL,
    kind public.estimate_revision_kind DEFAULT 'estimate'::public.estimate_revision_kind NOT NULL,
    status public.estimate_revision_status DEFAULT 'draft'::public.estimate_revision_status NOT NULL,
    notes text,
    customer_snapshot jsonb NOT NULL,
    vehicle_snapshot jsonb NOT NULL,
    subtotal numeric(14,2) DEFAULT 0 NOT NULL,
    tax_rate_bps integer DEFAULT 0 NOT NULL,
    tax_amount numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) DEFAULT 0 NOT NULL,
    public_token text,
    sent_at timestamp with time zone,
    created_by_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT estimate_revisions_check CHECK (((subtotal >= (0)::numeric) AND (tax_amount >= (0)::numeric) AND (total >= (0)::numeric) AND ((tax_rate_bps >= 0) AND (tax_rate_bps <= 10000)))),
    CONSTRAINT estimate_revisions_revision_no_check CHECK ((revision_no > 0))
);


ALTER TABLE public.estimate_revisions OWNER TO neondb_owner;

--
-- Name: estimate_revisions_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.estimate_revisions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.estimate_revisions_id_seq OWNER TO neondb_owner;

--
-- Name: estimate_revisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.estimate_revisions_id_seq OWNED BY public.estimate_revisions.id;


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.expenses (
    id integer NOT NULL,
    category text NOT NULL,
    description text NOT NULL,
    amount numeric(10,2) NOT NULL,
    vendor text,
    receipt_number text,
    expense_date date NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.expenses OWNER TO neondb_owner;

--
-- Name: expenses_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.expenses_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.expenses_id_seq OWNER TO neondb_owner;

--
-- Name: expenses_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.expenses_id_seq OWNED BY public.expenses.id;


--
-- Name: idempotency_keys; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.idempotency_keys (
    id integer NOT NULL,
    scope text NOT NULL,
    key text NOT NULL,
    request_hash text NOT NULL,
    response_status integer,
    response_body jsonb,
    completed_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.idempotency_keys OWNER TO neondb_owner;

--
-- Name: idempotency_keys_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.idempotency_keys_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.idempotency_keys_id_seq OWNER TO neondb_owner;

--
-- Name: idempotency_keys_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.idempotency_keys_id_seq OWNED BY public.idempotency_keys.id;


--
-- Name: inspections; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.inspections (
    id integer NOT NULL,
    vehicle_id integer NOT NULL,
    repair_order_id integer,
    inspected_by_id integer,
    type text NOT NULL,
    mileage integer,
    overall_condition text DEFAULT 'good'::text NOT NULL,
    items jsonb DEFAULT '[]'::jsonb,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    public_token text,
    sent_at timestamp with time zone,
    customer_signature_url text,
    customer_signed_at timestamp with time zone,
    customer_signer_name text,
    customer_ip text
);


ALTER TABLE public.inspections OWNER TO neondb_owner;

--
-- Name: inspections_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.inspections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.inspections_id_seq OWNER TO neondb_owner;

--
-- Name: inspections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.inspections_id_seq OWNED BY public.inspections.id;


--
-- Name: inventory; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.inventory (
    id integer NOT NULL,
    part_number text,
    name text NOT NULL,
    description text,
    category text NOT NULL,
    vendor text,
    cost_price numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    sell_price numeric(10,2) DEFAULT '0'::numeric NOT NULL,
    quantity integer DEFAULT 0 NOT NULL,
    min_quantity integer DEFAULT 0 NOT NULL,
    location text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    compatible_vehicles text,
    preferred_supplier_id integer,
    default_warranty_months integer,
    default_warranty_miles integer,
    square_catalog_object_id text,
    square_location_id text
);


ALTER TABLE public.inventory OWNER TO neondb_owner;

--
-- Name: inventory_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.inventory_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.inventory_id_seq OWNER TO neondb_owner;

--
-- Name: inventory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.inventory_id_seq OWNED BY public.inventory.id;


--
-- Name: invoice_items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.invoice_items (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    source_work_item_id integer NOT NULL,
    "position" integer NOT NULL,
    kind public.estimate_item_kind NOT NULL,
    description text NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit_price numeric(14,2) NOT NULL,
    unit_cost numeric(14,2),
    line_total numeric(14,2) NOT NULL,
    CONSTRAINT invoice_items_check CHECK (((quantity > (0)::numeric) AND (unit_price >= (0)::numeric) AND ((unit_cost IS NULL) OR (unit_cost >= (0)::numeric)))),
    CONSTRAINT invoice_items_position_check CHECK (("position" > 0))
);


ALTER TABLE public.invoice_items OWNER TO neondb_owner;

--
-- Name: invoice_items_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.invoice_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoice_items_id_seq OWNER TO neondb_owner;

--
-- Name: invoice_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.invoice_items_id_seq OWNED BY public.invoice_items.id;


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.invoices (
    id integer NOT NULL,
    invoice_number text NOT NULL,
    repair_order_id integer NOT NULL,
    customer_snapshot jsonb NOT NULL,
    vehicle_snapshot jsonb NOT NULL,
    status public.invoice_status DEFAULT 'draft'::public.invoice_status NOT NULL,
    notes text,
    subtotal numeric(14,2) DEFAULT 0 NOT NULL,
    tax_rate_bps integer DEFAULT 0 NOT NULL,
    tax_amount numeric(14,2) DEFAULT 0 NOT NULL,
    total numeric(14,2) DEFAULT 0 NOT NULL,
    amount_paid numeric(14,2) DEFAULT 0 NOT NULL,
    balance numeric(14,2) DEFAULT 0 NOT NULL,
    tax_exempt boolean DEFAULT false NOT NULL,
    tax_exempt_number text,
    public_token text,
    issued_at timestamp with time zone,
    issued_by_id integer,
    voided_at timestamp with time zone,
    voided_by_id integer,
    void_reason text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoices_check CHECK (((subtotal >= (0)::numeric) AND (tax_amount >= (0)::numeric) AND (total >= (0)::numeric) AND (amount_paid >= (0)::numeric) AND (balance >= (0)::numeric) AND ((tax_rate_bps >= 0) AND (tax_rate_bps <= 10000)))),
    CONSTRAINT invoices_check1 CHECK (((status <> 'void'::public.invoice_status) OR ((voided_at IS NOT NULL) AND (void_reason IS NOT NULL)))),
    CONSTRAINT invoices_version_check CHECK ((version > 0))
);


ALTER TABLE public.invoices OWNER TO neondb_owner;

--
-- Name: invoices_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.invoices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.invoices_id_seq OWNER TO neondb_owner;

--
-- Name: invoices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.invoices_id_seq OWNED BY public.invoices.id;


--
-- Name: messages; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.messages (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    repair_order_id integer,
    estimate_id integer,
    invoice_id integer,
    direction text NOT NULL,
    channel text DEFAULT 'sms'::text NOT NULL,
    from_number text,
    to_number text,
    body text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    failure_reason text,
    twilio_sid text,
    read_at timestamp with time zone,
    sent_by_user_id integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.messages OWNER TO neondb_owner;

--
-- Name: messages_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.messages_id_seq OWNER TO neondb_owner;

--
-- Name: messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.messages_id_seq OWNED BY public.messages.id;


--
-- Name: njmvc_categories; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.njmvc_categories (
    id integer NOT NULL,
    name text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.njmvc_categories OWNER TO neondb_owner;

--
-- Name: njmvc_categories_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.njmvc_categories_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.njmvc_categories_id_seq OWNER TO neondb_owner;

--
-- Name: njmvc_categories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.njmvc_categories_id_seq OWNED BY public.njmvc_categories.id;


--
-- Name: njmvc_inspection_results; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.njmvc_inspection_results (
    id integer NOT NULL,
    inspection_id integer NOT NULL,
    item_id integer NOT NULL,
    status text,
    repaired_date date,
    measurement_value text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.njmvc_inspection_results OWNER TO neondb_owner;

--
-- Name: njmvc_inspection_results_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.njmvc_inspection_results_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.njmvc_inspection_results_id_seq OWNER TO neondb_owner;

--
-- Name: njmvc_inspection_results_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.njmvc_inspection_results_id_seq OWNED BY public.njmvc_inspection_results.id;


--
-- Name: njmvc_inspections; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.njmvc_inspections (
    id integer NOT NULL,
    vehicle_id integer NOT NULL,
    operator_name text,
    address text,
    mechanic_name_print text,
    mechanic_name_signed text,
    report_number text,
    fleet_unit_number text,
    mileage integer,
    vehicle_type text,
    vin text,
    license_plate text,
    inspection_date date,
    certified_passed boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    purchase_date date
);


ALTER TABLE public.njmvc_inspections OWNER TO neondb_owner;

--
-- Name: njmvc_inspections_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.njmvc_inspections_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.njmvc_inspections_id_seq OWNER TO neondb_owner;

--
-- Name: njmvc_inspections_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.njmvc_inspections_id_seq OWNED BY public.njmvc_inspections.id;


--
-- Name: njmvc_items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.njmvc_items (
    id integer NOT NULL,
    category_id integer NOT NULL,
    label text NOT NULL,
    has_measurement boolean DEFAULT false NOT NULL,
    measurement_unit text,
    sort_order integer DEFAULT 0 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    measurement_position text
);


ALTER TABLE public.njmvc_items OWNER TO neondb_owner;

--
-- Name: njmvc_items_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.njmvc_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.njmvc_items_id_seq OWNER TO neondb_owner;

--
-- Name: njmvc_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.njmvc_items_id_seq OWNED BY public.njmvc_items.id;


--
-- Name: password_reset_tokens; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.password_reset_tokens (
    id integer NOT NULL,
    employee_id integer NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.password_reset_tokens OWNER TO neondb_owner;

--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.password_reset_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.password_reset_tokens_id_seq OWNER TO neondb_owner;

--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.password_reset_tokens_id_seq OWNED BY public.password_reset_tokens.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    invoice_id integer NOT NULL,
    amount numeric(14,2) NOT NULL,
    status public.payment_status DEFAULT 'pending'::public.payment_status NOT NULL,
    method text NOT NULL,
    processor text,
    processor_payment_id text,
    processor_event_id text,
    attempt_key text NOT NULL,
    idempotency_key text,
    parent_payment_id integer,
    reference_number text,
    failure_reason text,
    refunded_at timestamp with time zone,
    voided_at timestamp with time zone,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payments_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT payments_check CHECK ((((status = 'refunded'::public.payment_status) AND (parent_payment_id IS NOT NULL)) OR (parent_payment_id IS NULL) OR (status = 'void'::public.payment_status)))
);


ALTER TABLE public.payments OWNER TO neondb_owner;

--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.payments_id_seq OWNER TO neondb_owner;

--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: processor_webhook_receipts; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.processor_webhook_receipts (
    id integer NOT NULL,
    processor text NOT NULL,
    event_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    failure_reason text
);


ALTER TABLE public.processor_webhook_receipts OWNER TO neondb_owner;

--
-- Name: processor_webhook_receipts_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.processor_webhook_receipts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.processor_webhook_receipts_id_seq OWNER TO neondb_owner;

--
-- Name: processor_webhook_receipts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.processor_webhook_receipts_id_seq OWNED BY public.processor_webhook_receipts.id;


--
-- Name: purchase_line_items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.purchase_line_items (
    id integer NOT NULL,
    purchase_id integer NOT NULL,
    item_type text NOT NULL,
    inventory_id integer,
    used_car_id integer,
    description text NOT NULL,
    quantity numeric(10,2) DEFAULT '1'::numeric NOT NULL,
    unit_cost numeric(10,2) NOT NULL,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.purchase_line_items OWNER TO neondb_owner;

--
-- Name: purchase_line_items_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.purchase_line_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.purchase_line_items_id_seq OWNER TO neondb_owner;

--
-- Name: purchase_line_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.purchase_line_items_id_seq OWNED BY public.purchase_line_items.id;


--
-- Name: purchases; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.purchases (
    id integer NOT NULL,
    supplier_legacy text,
    supplier_contact text,
    supplier_email text,
    supplier_phone text,
    invoice_number text,
    amount numeric(10,2) NOT NULL,
    tax numeric(10,2) DEFAULT '0'::numeric,
    shipping numeric(10,2) DEFAULT '0'::numeric,
    status text DEFAULT 'pending'::text NOT NULL,
    purchase_date date NOT NULL,
    notes text,
    invoice_file_path text,
    invoice_file_name text,
    invoice_file_type text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    supplier_id integer
);


ALTER TABLE public.purchases OWNER TO neondb_owner;

--
-- Name: purchases_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.purchases_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.purchases_id_seq OWNER TO neondb_owner;

--
-- Name: purchases_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.purchases_id_seq OWNED BY public.purchases.id;


--
-- Name: reminders; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.reminders (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    vehicle_id integer,
    service_type text NOT NULL,
    due_date date NOT NULL,
    due_mileage integer,
    sent boolean DEFAULT false NOT NULL,
    sent_at timestamp without time zone,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.reminders OWNER TO neondb_owner;

--
-- Name: reminders_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.reminders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.reminders_id_seq OWNER TO neondb_owner;

--
-- Name: reminders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.reminders_id_seq OWNED BY public.reminders.id;


--
-- Name: repair_order_events; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.repair_order_events (
    id integer NOT NULL,
    repair_order_id integer NOT NULL,
    event_type public.repair_order_event_type NOT NULL,
    actor_id integer,
    actor_label text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.repair_order_events OWNER TO neondb_owner;

--
-- Name: repair_order_events_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.repair_order_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.repair_order_events_id_seq OWNER TO neondb_owner;

--
-- Name: repair_order_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.repair_order_events_id_seq OWNED BY public.repair_order_events.id;


--
-- Name: repair_order_work_items; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.repair_order_work_items (
    id integer NOT NULL,
    repair_order_id integer NOT NULL,
    source_estimate_item_id integer NOT NULL,
    "position" integer NOT NULL,
    kind public.estimate_item_kind NOT NULL,
    description text NOT NULL,
    quantity numeric(14,3) NOT NULL,
    unit_price numeric(14,2) NOT NULL,
    unit_cost numeric(14,2),
    estimated_hours numeric(10,2),
    status public.repair_order_work_item_status DEFAULT 'authorized'::public.repair_order_work_item_status NOT NULL,
    authorized_at timestamp with time zone DEFAULT now() NOT NULL,
    performed_at timestamp with time zone,
    performed_by_id integer,
    voided_at timestamp with time zone,
    void_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT repair_order_work_items_check CHECK (((quantity > (0)::numeric) AND (unit_price >= (0)::numeric) AND ((unit_cost IS NULL) OR (unit_cost >= (0)::numeric)) AND ((estimated_hours IS NULL) OR (estimated_hours >= (0)::numeric)))),
    CONSTRAINT repair_order_work_items_position_check CHECK (("position" > 0))
);


ALTER TABLE public.repair_order_work_items OWNER TO neondb_owner;

--
-- Name: repair_order_work_items_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.repair_order_work_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.repair_order_work_items_id_seq OWNER TO neondb_owner;

--
-- Name: repair_order_work_items_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.repair_order_work_items_id_seq OWNED BY public.repair_order_work_items.id;


--
-- Name: repair_orders; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.repair_orders (
    id integer NOT NULL,
    order_number text NOT NULL,
    customer_id integer NOT NULL,
    vehicle_id integer NOT NULL,
    used_car_id integer,
    internal boolean DEFAULT false NOT NULL,
    assigned_to_id integer,
    created_by_id integer NOT NULL,
    status public.repair_order_status DEFAULT 'open'::public.repair_order_status NOT NULL,
    priority public.repair_order_priority DEFAULT 'normal'::public.repair_order_priority NOT NULL,
    complaint text,
    diagnosis text,
    notes text,
    mileage_in integer,
    mileage_out integer,
    promised_at timestamp with time zone,
    opened_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancellation_reason text,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT repair_orders_check CHECK (((mileage_out IS NULL) OR (mileage_in IS NULL) OR (mileage_out >= mileage_in))),
    CONSTRAINT repair_orders_check1 CHECK ((((status <> 'completed'::public.repair_order_status) OR (completed_at IS NOT NULL)) AND ((status <> 'cancelled'::public.repair_order_status) OR ((cancelled_at IS NOT NULL) AND (cancellation_reason IS NOT NULL))))),
    CONSTRAINT repair_orders_version_check CHECK ((version > 0))
);


ALTER TABLE public.repair_orders OWNER TO neondb_owner;

--
-- Name: repair_orders_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.repair_orders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.repair_orders_id_seq OWNER TO neondb_owner;

--
-- Name: repair_orders_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.repair_orders_id_seq OWNED BY public.repair_orders.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.role_permissions (
    id integer NOT NULL,
    role text NOT NULL,
    resource text NOT NULL,
    action text NOT NULL
);


ALTER TABLE public.role_permissions OWNER TO neondb_owner;

--
-- Name: role_permissions_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.role_permissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.role_permissions_id_seq OWNER TO neondb_owner;

--
-- Name: role_permissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.role_permissions_id_seq OWNED BY public.role_permissions.id;


--
-- Name: shop_settings; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.shop_settings (
    id integer NOT NULL,
    labor_rate numeric(10,2) DEFAULT 95 NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    stripe_publishable_key text,
    stripe_secret_key text,
    stripe_webhook_secret text,
    stripe_ach_enabled boolean DEFAULT false NOT NULL,
    twilio_account_sid text,
    twilio_auth_token text,
    twilio_from_number text
);


ALTER TABLE public.shop_settings OWNER TO neondb_owner;

--
-- Name: shop_settings_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.shop_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.shop_settings_id_seq OWNER TO neondb_owner;

--
-- Name: shop_settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.shop_settings_id_seq OWNED BY public.shop_settings.id;


--
-- Name: square_mappings; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.square_mappings (
    id integer NOT NULL,
    entity_type text NOT NULL,
    local_id integer NOT NULL,
    square_id text NOT NULL,
    square_version integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.square_mappings OWNER TO neondb_owner;

--
-- Name: square_mappings_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.square_mappings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.square_mappings_id_seq OWNER TO neondb_owner;

--
-- Name: square_mappings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.square_mappings_id_seq OWNED BY public.square_mappings.id;


--
-- Name: square_sync_states; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.square_sync_states (
    id integer NOT NULL,
    resource text NOT NULL,
    cursor text,
    last_synced_at timestamp with time zone,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.square_sync_states OWNER TO neondb_owner;

--
-- Name: square_sync_states_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.square_sync_states_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.square_sync_states_id_seq OWNER TO neondb_owner;

--
-- Name: square_sync_states_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.square_sync_states_id_seq OWNED BY public.square_sync_states.id;


--
-- Name: square_webhook_events; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.square_webhook_events (
    id integer NOT NULL,
    square_event_id text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    processed_at timestamp with time zone,
    failure_reason text,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.square_webhook_events OWNER TO neondb_owner;

--
-- Name: square_webhook_events_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.square_webhook_events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.square_webhook_events_id_seq OWNER TO neondb_owner;

--
-- Name: square_webhook_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.square_webhook_events_id_seq OWNED BY public.square_webhook_events.id;


--
-- Name: stock_movements; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.stock_movements (
    id integer NOT NULL,
    inventory_id integer NOT NULL,
    delta integer NOT NULL,
    reason text NOT NULL,
    reference_table text,
    reference_id integer,
    reference_line_id integer,
    unit_cost numeric(10,2),
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_id integer,
    work_item_id integer
);


ALTER TABLE public.stock_movements OWNER TO neondb_owner;

--
-- Name: stock_movements_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.stock_movements_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.stock_movements_id_seq OWNER TO neondb_owner;

--
-- Name: stock_movements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.stock_movements_id_seq OWNED BY public.stock_movements.id;


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.suppliers (
    id integer NOT NULL,
    name text NOT NULL,
    account_number text,
    payment_terms text,
    contact_name text,
    contact_email text,
    contact_phone text,
    address text,
    notes text,
    archived boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.suppliers OWNER TO neondb_owner;

--
-- Name: suppliers_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.suppliers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.suppliers_id_seq OWNER TO neondb_owner;

--
-- Name: suppliers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.suppliers_id_seq OWNED BY public.suppliers.id;


--
-- Name: time_entries; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.time_entries (
    id integer NOT NULL,
    employee_id integer NOT NULL,
    repair_order_id integer,
    work_item_id integer,
    clock_in timestamp with time zone NOT NULL,
    clock_out timestamp with time zone,
    total_hours numeric(10,2),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.time_entries OWNER TO neondb_owner;

--
-- Name: time_entries_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.time_entries_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.time_entries_id_seq OWNER TO neondb_owner;

--
-- Name: time_entries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.time_entries_id_seq OWNED BY public.time_entries.id;


--
-- Name: used_cars; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.used_cars (
    id integer NOT NULL,
    vin text,
    year integer NOT NULL,
    make text NOT NULL,
    model text NOT NULL,
    "trim" text,
    color text,
    mileage integer,
    condition text,
    purchase_price numeric(10,2) NOT NULL,
    selling_price numeric(10,2),
    status text DEFAULT 'needs_work'::text NOT NULL,
    customer_id integer,
    purchase_date date,
    sale_date date,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    engine_type text,
    transmission_type text,
    buyer_id integer,
    sale_invoice_id integer,
    published boolean DEFAULT false NOT NULL
);


ALTER TABLE public.used_cars OWNER TO neondb_owner;

--
-- Name: used_cars_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.used_cars_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.used_cars_id_seq OWNER TO neondb_owner;

--
-- Name: used_cars_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.used_cars_id_seq OWNED BY public.used_cars.id;


--
-- Name: user_board_preferences; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.user_board_preferences (
    id integer NOT NULL,
    user_id integer NOT NULL,
    board_key text NOT NULL,
    column_order text[] DEFAULT '{}'::text[] NOT NULL,
    hidden_columns text[] DEFAULT '{}'::text[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.user_board_preferences OWNER TO neondb_owner;

--
-- Name: user_board_preferences_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.user_board_preferences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_board_preferences_id_seq OWNER TO neondb_owner;

--
-- Name: user_board_preferences_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.user_board_preferences_id_seq OWNED BY public.user_board_preferences.id;


--
-- Name: vehicles; Type: TABLE; Schema: public; Owner: neondb_owner
--

CREATE TABLE public.vehicles (
    id integer NOT NULL,
    customer_id integer NOT NULL,
    vin text,
    license_plate text,
    year integer NOT NULL,
    make text NOT NULL,
    model text NOT NULL,
    "trim" text,
    color text,
    mileage integer,
    engine_type text,
    transmission_type text,
    notes text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    fleet_number text
);


ALTER TABLE public.vehicles OWNER TO neondb_owner;

--
-- Name: vehicles_id_seq; Type: SEQUENCE; Schema: public; Owner: neondb_owner
--

CREATE SEQUENCE public.vehicles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.vehicles_id_seq OWNER TO neondb_owner;

--
-- Name: vehicles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: neondb_owner
--

ALTER SEQUENCE public.vehicles_id_seq OWNED BY public.vehicles.id;


--
-- Name: activity_events id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.activity_events ALTER COLUMN id SET DEFAULT nextval('public.activity_events_id_seq'::regclass);


--
-- Name: appointments id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.appointments ALTER COLUMN id SET DEFAULT nextval('public.appointments_id_seq'::regclass);


--
-- Name: attachments id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.attachments ALTER COLUMN id SET DEFAULT nextval('public.attachments_id_seq'::regclass);


--
-- Name: canned_jobs id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.canned_jobs ALTER COLUMN id SET DEFAULT nextval('public.canned_jobs_id_seq'::regclass);


--
-- Name: customer_categories id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.customer_categories ALTER COLUMN id SET DEFAULT nextval('public.customer_categories_id_seq'::regclass);


--
-- Name: customers id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.customers ALTER COLUMN id SET DEFAULT nextval('public.customers_id_seq'::regclass);


--
-- Name: email_templates id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.email_templates ALTER COLUMN id SET DEFAULT nextval('public.email_templates_id_seq'::regclass);


--
-- Name: employees id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.employees ALTER COLUMN id SET DEFAULT nextval('public.employees_id_seq'::regclass);


--
-- Name: estimate_approval_items id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approval_items ALTER COLUMN id SET DEFAULT nextval('public.estimate_approval_items_id_seq'::regclass);


--
-- Name: estimate_approvals id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approvals ALTER COLUMN id SET DEFAULT nextval('public.estimate_approvals_id_seq'::regclass);


--
-- Name: estimate_items id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_items ALTER COLUMN id SET DEFAULT nextval('public.estimate_items_id_seq'::regclass);


--
-- Name: estimate_revisions id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_revisions ALTER COLUMN id SET DEFAULT nextval('public.estimate_revisions_id_seq'::regclass);


--
-- Name: expenses id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.expenses ALTER COLUMN id SET DEFAULT nextval('public.expenses_id_seq'::regclass);


--
-- Name: idempotency_keys id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.idempotency_keys ALTER COLUMN id SET DEFAULT nextval('public.idempotency_keys_id_seq'::regclass);


--
-- Name: inspections id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inspections ALTER COLUMN id SET DEFAULT nextval('public.inspections_id_seq'::regclass);


--
-- Name: inventory id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inventory ALTER COLUMN id SET DEFAULT nextval('public.inventory_id_seq'::regclass);


--
-- Name: invoice_items id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoice_items ALTER COLUMN id SET DEFAULT nextval('public.invoice_items_id_seq'::regclass);


--
-- Name: invoices id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices ALTER COLUMN id SET DEFAULT nextval('public.invoices_id_seq'::regclass);


--
-- Name: messages id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages ALTER COLUMN id SET DEFAULT nextval('public.messages_id_seq'::regclass);


--
-- Name: njmvc_categories id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_categories ALTER COLUMN id SET DEFAULT nextval('public.njmvc_categories_id_seq'::regclass);


--
-- Name: njmvc_inspection_results id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_inspection_results ALTER COLUMN id SET DEFAULT nextval('public.njmvc_inspection_results_id_seq'::regclass);


--
-- Name: njmvc_inspections id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_inspections ALTER COLUMN id SET DEFAULT nextval('public.njmvc_inspections_id_seq'::regclass);


--
-- Name: njmvc_items id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_items ALTER COLUMN id SET DEFAULT nextval('public.njmvc_items_id_seq'::regclass);


--
-- Name: password_reset_tokens id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.password_reset_tokens ALTER COLUMN id SET DEFAULT nextval('public.password_reset_tokens_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: processor_webhook_receipts id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.processor_webhook_receipts ALTER COLUMN id SET DEFAULT nextval('public.processor_webhook_receipts_id_seq'::regclass);


--
-- Name: purchase_line_items id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchase_line_items ALTER COLUMN id SET DEFAULT nextval('public.purchase_line_items_id_seq'::regclass);


--
-- Name: purchases id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchases ALTER COLUMN id SET DEFAULT nextval('public.purchases_id_seq'::regclass);


--
-- Name: reminders id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.reminders ALTER COLUMN id SET DEFAULT nextval('public.reminders_id_seq'::regclass);


--
-- Name: repair_order_events id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_events ALTER COLUMN id SET DEFAULT nextval('public.repair_order_events_id_seq'::regclass);


--
-- Name: repair_order_work_items id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_work_items ALTER COLUMN id SET DEFAULT nextval('public.repair_order_work_items_id_seq'::regclass);


--
-- Name: repair_orders id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders ALTER COLUMN id SET DEFAULT nextval('public.repair_orders_id_seq'::regclass);


--
-- Name: role_permissions id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.role_permissions ALTER COLUMN id SET DEFAULT nextval('public.role_permissions_id_seq'::regclass);


--
-- Name: shop_settings id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.shop_settings ALTER COLUMN id SET DEFAULT nextval('public.shop_settings_id_seq'::regclass);


--
-- Name: square_mappings id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_mappings ALTER COLUMN id SET DEFAULT nextval('public.square_mappings_id_seq'::regclass);


--
-- Name: square_sync_states id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_sync_states ALTER COLUMN id SET DEFAULT nextval('public.square_sync_states_id_seq'::regclass);


--
-- Name: square_webhook_events id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_webhook_events ALTER COLUMN id SET DEFAULT nextval('public.square_webhook_events_id_seq'::regclass);


--
-- Name: stock_movements id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.stock_movements ALTER COLUMN id SET DEFAULT nextval('public.stock_movements_id_seq'::regclass);


--
-- Name: suppliers id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.suppliers ALTER COLUMN id SET DEFAULT nextval('public.suppliers_id_seq'::regclass);


--
-- Name: time_entries id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.time_entries ALTER COLUMN id SET DEFAULT nextval('public.time_entries_id_seq'::regclass);


--
-- Name: used_cars id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.used_cars ALTER COLUMN id SET DEFAULT nextval('public.used_cars_id_seq'::regclass);


--
-- Name: user_board_preferences id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.user_board_preferences ALTER COLUMN id SET DEFAULT nextval('public.user_board_preferences_id_seq'::regclass);


--
-- Name: vehicles id; Type: DEFAULT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.vehicles ALTER COLUMN id SET DEFAULT nextval('public.vehicles_id_seq'::regclass);


--
-- Data for Name: activity_events; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.activity_events (id, entity_type, entity_id, event_type, actor_id, actor_label, meta, created_at) FROM stdin;
1	repair_order	10	created	9	admin	{"status": "open", "vehicleId": 9, "customerId": 6, "orderNumber": "RO-1010"}	2026-05-03 11:59:53.057801
2	customer	6	created	9	admin	{"status": "open", "mirrorOf": {"entityId": 10, "entityType": "repair_order"}, "vehicleId": 9, "customerId": 6, "orderNumber": "RO-1010"}	2026-05-03 11:59:53.057801
3	supplier	2	created	9	admin	{"name": "AutoZone Test"}	2026-05-03 12:24:30.069012
4	supplier	2	deleted	9	admin	{"name": "AutoZone Test"}	2026-05-03 12:24:37.453128
5	supplier	3	created	9	admin	{"name": "Acme-rw70kZ"}	2026-05-03 12:29:26.031048
6	supplier	3	updated	9	admin	{"name": "Acme-rw70kZ"}	2026-05-03 12:30:01.064545
7	repair_order	11	created	9	admin	{"status": "pending", "vehicleId": 9, "customerId": 6, "orderNumber": "RO-1011"}	2026-05-05 01:29:14.378599
8	customer	6	created	9	admin	{"status": "pending", "mirrorOf": {"entityId": 11, "entityType": "repair_order"}, "vehicleId": 9, "customerId": 6, "orderNumber": "RO-1011"}	2026-05-05 01:29:14.378599
9	repair_order	11	status_changed	9	admin	{"to": "completed", "from": "pending"}	2026-05-05 01:29:47.837897
10	customer	6	status_changed	9	admin	{"to": "completed", "from": "pending", "mirrorOf": {"entityId": 11, "entityType": "repair_order"}}	2026-05-05 01:29:47.837897
11	repair_order	11	email_sent	9	admin	{"to": "jane.web@example.com", "template": "repair_order_completed"}	2026-05-05 01:29:48.113834
12	customer	6	email_sent	9	admin	{"to": "jane.web@example.com", "mirrorOf": {"entityId": 11, "entityType": "repair_order"}, "template": "repair_order_completed"}	2026-05-05 01:29:48.113834
13	repair_order	11	deleted	9	admin	{"orderNumber": "RO-1011"}	2026-07-04 17:20:24.954311
14	customer	6	deleted	9	admin	{"mirrorOf": {"entityId": 11, "entityType": "repair_order"}, "orderNumber": "RO-1011"}	2026-07-04 17:20:24.954311
15	repair_order	10	deleted	9	admin	{"orderNumber": "RO-1010"}	2026-07-04 17:20:30.491701
16	customer	6	deleted	9	admin	{"mirrorOf": {"entityId": 10, "entityType": "repair_order"}, "orderNumber": "RO-1010"}	2026-07-04 17:20:30.491701
\.


--
-- Data for Name: appointments; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.appointments (id, customer_id, vehicle_id, assigned_to_id, status, service_type, description, scheduled_at, estimated_duration, notes, created_at, updated_at) FROM stdin;
1	1	1	1	scheduled	Oil Change	Full synthetic oil change and multi-point inspection	2026-03-31 05:53:55.037199	60	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
2	2	2	3	confirmed	Brake Service	Front brake replacement	2026-03-31 07:53:55.037199	180	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
3	3	4	5	scheduled	Diagnostics	Check engine light diagnosis	2026-04-01 03:53:55.037199	120	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
4	4	5	1	completed	Tune-Up	Annual tune-up completed	2026-03-28 03:53:55.037199	150	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
5	5	6	3	completed	Oil Change	Synthetic oil change	2026-03-26 03:53:55.037199	45	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
6	2	2	\N	scheduled	Oil Change	\N	2026-03-31 08:20:00	60	\N	2026-03-31 04:21:08.267346	2026-03-31 04:21:08.267346
7	6	9	\N	scheduled	Oil change & inspection	\N	2026-05-15 10:30:00	\N	approved via test	2026-05-02 22:17:56.451353	2026-05-02 23:13:40.609
\.


--
-- Data for Name: attachments; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.attachments (id, owner_type, owner_id, file_name, mime_type, size, storage_path, notes, uploaded_by_id, created_at) FROM stdin;
5	repair_order	9	Screenshot_20260501_193442.jpg	image/jpeg	184910	owners/repair_order/9/1777782844022-Screenshot_20260501_193442.jpg	\N	9	2026-05-03 04:34:04.064431
\.


--
-- Data for Name: canned_jobs; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.canned_jobs (id, name, category, description, estimated_hours, items, created_at, updated_at) FROM stdin;
1	Front Brake Service	Brakes	\N	1.50	[{"type": "labor", "quantity": 1.5, "unitPrice": 120, "description": "Replace front brake pads & rotors"}, {"type": "part", "quantity": 1, "unitPrice": 65, "description": "Front brake pads (set)"}]	2026-05-03 05:32:06.533809	2026-05-03 05:32:06.533809
\.


--
-- Data for Name: customer_categories; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.customer_categories (id, name, description, labor_rate, parts_markup, created_at, updated_at) FROM stdin;
1	Vip		80.00	1.50	2026-04-05 20:50:40.24775	2026-04-05 20:50:40.24775
\.


--
-- Data for Name: customers; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.customers (id, first_name, last_name, email, phone, address, city, state, zip, notes, created_at, updated_at, category_id, preferred_channel, sms_opt_out, tax_exempt, tax_exempt_number, square_customer_id) FROM stdin;
2	Sarah	Thompson	sarah.t@email.com	(555) 345-6789	87 Pine Ave	Austin	TX	78702	Fleet account - 3 vehicles	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	\N	email	false	f	\N	\N
3	Robert	Chen	rchen@email.com	(555) 456-7890	315 Maple Dr	Round Rock	TX	78664	\N	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	\N	email	false	f	\N	\N
4	Emily	Williams	emily.w@email.com	(555) 567-8901	29 Cedar Ln	Pflugerville	TX	78660	Senior discount applies	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	\N	email	false	f	\N	\N
5	Marcus	Johnson	marcus.j@email.com	(555) 678-9012	1028 Elm St	Austin	TX	78703	Referred by James Martinez	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	\N	email	false	f	\N	\N
1	James	Martinez	james.martinez@email.com	(555) 234-5678	142 Oak Street	Austin	TX	78701	Regular customer, prefers morning appointments (updated)	2026-03-31 03:52:28.68589	2026-04-20 01:56:47.616	\N	email	false	f	\N	\N
6	Jane	Webform	jane.web@example.com	555-0199					Created via web form	2026-05-02 22:17:56.226863	2026-05-03 08:58:31.835	\N	email	false	f	\N	\N
\.


--
-- Data for Name: email_templates; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.email_templates (id, key, name, subject, body_html, from_name, from_email, enabled, updated_at) FROM stdin;
1	appointment_confirmed	Appointment Confirmation	Your appointment is confirmed - {{shopName}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #f59e0b; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Appointment Confirmed</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    <p>Hi {{customerName}},</p>\n    <p>Great news — your appointment with <strong>{{shopName}}</strong> has been confirmed.</p>\n    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">\n      <tr><td style="padding: 8px 0; color: #6b7280;">Date & Time</td><td style="padding: 8px 0; font-weight: bold;">{{appointmentDateTime}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Service</td><td style="padding: 8px 0; font-weight: bold;">{{serviceType}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Vehicle</td><td style="padding: 8px 0; font-weight: bold;">{{vehicleInfo}}</td></tr>\n    </table>\n    <p>If you need to reschedule or have any questions, please reply to this email or call us.</p>\n    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">\n      Thank you for choosing {{shopName}}!\n    </p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-05-02 23:12:58.087021
2	invoice_sent	Invoice Sent	Invoice {{invoiceNumber}} from {{shopName}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Invoice Ready</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>Hi {{customerName}},</p>\n    <p>Your invoice from <strong>{{shopName}}</strong> is ready.</p>\n    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">\n      <tr><td style="padding: 8px 0; color: #6b7280;">Invoice #</td><td style="padding: 8px 0; font-weight: bold;">{{invoiceNumber}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Total</td><td style="padding: 8px 0; font-weight: bold;">{{total}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Balance Due</td><td style="padding: 8px 0; font-weight: bold;">{{balance}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Due Date</td><td style="padding: 8px 0; font-weight: bold;">{{dueDate}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Vehicle</td><td style="padding: 8px 0; font-weight: bold;">{{vehicleInfo}}</td></tr>\n    </table>\n    {{payLinkSection}}\n    <p>Please reply to this email if you have any questions about the charges.</p>\n    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">\n      Thank you for choosing {{shopName}}!\n    </p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-05-03 05:36:37.78237
7	inspection_sent	Inspection Sent	Your vehicle inspection is ready - {{shopName}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #0d9488; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Vehicle Inspection Ready</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>Hi {{customerName}},</p>\n    <p>We've completed a digital inspection of your <strong>{{vehicleInfo}}</strong> at <strong>{{shopName}}</strong>.</p>\n    <p>Tap the button below to see condition photos and approve or decline any recommended work — right from your phone.</p>\n    <p style="text-align:center;margin:28px 0;">\n      <a href="{{inspectionUrl}}" style="background:#0d9488;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-weight:bold;">View Inspection</a>\n    </p>\n    <p style="font-size:12px;color:#6b7280;word-break:break-all;">Or open this link: {{inspectionUrl}}</p>\n    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">\n      Thank you for choosing {{shopName}}!\n    </p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-05-03 09:17:49.287747
3	repair_order_completed	Repair Order Completed	Your vehicle is ready for pickup - {{shopName}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #16a34a; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Your Vehicle Is Ready</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>Hi {{customerName}},</p>\n    <p>Good news — work on your <strong>{{vehicleInfo}}</strong> is complete and your vehicle is ready for pickup.</p>\n    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">\n      <tr><td style="padding: 8px 0; color: #6b7280;">Order #</td><td style="padding: 8px 0; font-weight: bold;">{{orderNumber}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Work Done</td><td style="padding: 8px 0; font-weight: bold;">{{diagnosis}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Mileage Out</td><td style="padding: 8px 0; font-weight: bold;">{{mileageOut}}</td></tr>\n    </table>\n    <p>Please give us a call or stop by during business hours to pick up your vehicle. An invoice will follow shortly if it hasn't already.</p>\n    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">\n      Thanks for trusting {{shopName}} with your vehicle.\n    </p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-05-03 05:36:37.81963
4	service_reminder	Service Reminder	Time for your {{serviceType}} - {{shopName}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #f59e0b; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Service Reminder</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>Hi {{customerName}},</p>\n    <p>This is a friendly reminder from <strong>{{shopName}}</strong> that your <strong>{{vehicleInfo}}</strong> is due for service.</p>\n    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">\n      <tr><td style="padding: 8px 0; color: #6b7280;">Service</td><td style="padding: 8px 0; font-weight: bold;">{{serviceType}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Due Date</td><td style="padding: 8px 0; font-weight: bold;">{{dueDate}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Due Mileage</td><td style="padding: 8px 0; font-weight: bold;">{{dueMileage}}</td></tr>\n    </table>\n    <p>Reply to this email or give us a call to schedule your appointment.</p>\n    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">\n      {{shopName}}\n    </p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-05-03 05:36:37.82421
5	payment_received	Payment Receipt	Payment received - {{shopName}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #0ea5e9; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Payment Received</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>Hi {{customerName}},</p>\n    <p>We've received your payment — thank you!</p>\n    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">\n      <tr><td style="padding: 8px 0; color: #6b7280;">Invoice #</td><td style="padding: 8px 0; font-weight: bold;">{{invoiceNumber}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Amount Paid</td><td style="padding: 8px 0; font-weight: bold;">{{amount}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Method</td><td style="padding: 8px 0; font-weight: bold;">{{method}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Reference</td><td style="padding: 8px 0; font-weight: bold;">{{referenceNumber}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Remaining Balance</td><td style="padding: 8px 0; font-weight: bold;">{{balance}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Paid On</td><td style="padding: 8px 0; font-weight: bold;">{{paidAt}}</td></tr>\n    </table>\n    <p>Keep this email as your receipt.</p>\n    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">\n      Thank you for your business — {{shopName}}\n    </p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-05-03 05:36:37.831298
6	estimate_sent	Estimate Sent	Estimate {{estimateNumber}} from {{shopName}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #7c3aed; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Estimate Ready for Review</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>Hi {{customerName}},</p>\n    <p>Your estimate from <strong>{{shopName}}</strong> is ready for your review.</p>\n    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">\n      <tr><td style="padding: 8px 0; color: #6b7280;">Estimate #</td><td style="padding: 8px 0; font-weight: bold;">{{estimateNumber}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Total</td><td style="padding: 8px 0; font-weight: bold;">{{total}}</td></tr>\n    </table>\n    <p style="text-align:center;margin:28px 0;">\n      <a href="{{estimateUrl}}" style="background:#7c3aed;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-weight:bold;">Review & approve</a>\n    </p>\n    <p style="font-size:12px;color:#6b7280;word-break:break-all;">Or open this link: {{estimateUrl}}</p>\n    <p style="color: #6b7280; font-size: 14px; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb;">\n      Thank you for choosing {{shopName}}!\n    </p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-05-03 09:04:50.860833
8	password_reset_request	Password Reset Request	Password reset request for {{requesterUsername}}	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #b91c1c; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Password Reset Request</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>A user has requested a password reset. No password or reset link was generated.</p>\n    <table style="width: 100%; margin: 20px 0; border-collapse: collapse;">\n      <tr><td style="padding: 8px 0; color: #6b7280;">Username</td><td style="padding: 8px 0; font-weight: bold;">{{requesterUsername}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Name</td><td style="padding: 8px 0; font-weight: bold;">{{requesterName}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Email</td><td style="padding: 8px 0; font-weight: bold;">{{requesterEmail}}</td></tr>\n      <tr><td style="padding: 8px 0; color: #6b7280;">Requested at</td><td style="padding: 8px 0; font-weight: bold;">{{requestedAt}}</td></tr>\n    </table>\n    <p>Use the authenticated Users page to manually set a new password for this user. Do not send passwords by email.</p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-09-05 00:34:10.584074
9	password_reset_self_service	Password Reset Self-Service	Reset your 915motors password	<!DOCTYPE html>\n<html>\n<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">\n  <div style="background: #2563eb; color: white; padding: 20px; border-radius: 8px 8px 0 0;">\n    <h1 style="margin: 0;">Reset Your Password</h1>\n  </div>\n  <div style="background: #fff; padding: 20px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">\n    \n    <p>Hi {{requesterName}},</p>\n    <p>Use the secure link below to choose a new password for your 915motors account.</p>\n    <p style="text-align:center;margin:28px 0;">\n      <a href="{{resetUrl}}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;display:inline-block;font-weight:bold;">Reset password</a>\n    </p>\n    <p style="font-size:12px;color:#6b7280;word-break:break-all;">Or open this link: {{resetUrl}}</p>\n    <p>This link expires in {{expiresIn}} and can only be used once. Never share this link with anyone.</p>\n  </div>\n</body>\n</html>	915motors	contact@znmotors.com	true	2026-09-05 00:55:18.649572
\.


--
-- Data for Name: employees; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.employees (id, first_name, last_name, email, phone, role, hourly_rate, active, hire_date, notes, clocked_in, created_at, updated_at, roles, username, password_hash, last_login_at) FROM stdin;
1	Tony	Alvarez	tony@shopOS.com	(555) 100-1001	technician	28.00	t	2021-03-15	\N	f	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	{technician}	\N	\N	\N
2	Megan	Park	megan@shopOS.com	(555) 100-1002	service_advisor	22.00	t	2022-06-01	\N	f	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	{service_advisor}	\N	\N	\N
3	Derek	Burns	derek@shopOS.com	(555) 100-1003	technician	30.00	t	2020-09-10	\N	f	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	{technician}	\N	\N	\N
4	Lisa	Nguyen	lisa@shopOS.com	(555) 100-1004	manager	45.00	t	2019-01-20	\N	f	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	{manager}	\N	\N	\N
5	Carlos	Rivera	carlos@shopOS.com	(555) 100-1005	technician	26.00	t	2023-02-14	\N	f	2026-03-31 03:52:28.68589	2026-03-31 03:52:28.68589	{technician}	\N	\N	\N
10	Test	Tech-1777759184340	\N	\N	viewer	\N	t	\N	\N	f	2026-05-02 22:02:12.044684	2026-05-02 22:02:12.044684	{viewer,technician}	testtech184340	$2b$10$pGSrXgpMX9SiTq1pgWxyhO0w4M61OVP6mqb2YEjsV9AaFSGVMQgka	2026-05-02 22:02:37.096222
11	Test	Tech1777759464061	\N	\N	technician	\N	t	\N	\N	t	2026-05-02 22:05:19.844664	2026-07-03 06:17:40.709	{technician}	tt464061	$2b$10$feK.2tgOzsLxqymU2xw/xuN.FEeKZLQOncT0XPYuAJrJn9sfhI4Sy	2026-05-02 22:05:38.175625
9	Admin	User	915motorsusa@gmail.com	\N	admin	\N	t	\N	\N	f	2026-05-02 21:58:14.522499	2026-09-05 01:26:01.924843	{admin}	admin	$2b$10$GdBj.lKTGLaHYJ717SNwp.yBvqDzcsfvWl6tmfawHxs0fycKHRGgi	2026-09-04 03:25:03.949067
\.


--
-- Data for Name: estimate_approval_items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.estimate_approval_items (id, approval_id, estimate_item_id, decision) FROM stdin;
\.


--
-- Data for Name: estimate_approvals; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.estimate_approvals (id, estimate_revision_id, decision, signer_name, signer_email, signature_url, document_hash, request_ip, request_user_agent, decided_at, metadata, created_at) FROM stdin;
\.


--
-- Data for Name: estimate_items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.estimate_items (id, estimate_revision_id, "position", kind, description, quantity, unit_price, unit_cost, inventory_item_id, estimated_hours, warranty_months, warranty_miles) FROM stdin;
\.


--
-- Data for Name: estimate_revisions; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.estimate_revisions (id, repair_order_id, revision_no, kind, status, notes, customer_snapshot, vehicle_snapshot, subtotal, tax_rate_bps, tax_amount, total, public_token, sent_at, created_by_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: expenses; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.expenses (id, category, description, amount, vendor, receipt_number, expense_date, notes, created_at, updated_at) FROM stdin;
1	Supplies	Shop towels and cleaning supplies	87.50	Home Depot	\N	2026-03-29	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
2	Parts Purchase	Brake parts bulk order	450.00	NAPA Auto Parts	\N	2026-03-26	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
3	Equipment	New tire changing machine maintenance	125.00	Hunter Engineering	\N	2026-03-23	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
4	Utilities	Monthly electricity bill	380.00	City Electric	\N	2026-03-30	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
5	Marketing	Local newspaper ad	150.00	Austin Chronicle	\N	2026-03-21	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
\.


--
-- Data for Name: idempotency_keys; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.idempotency_keys (id, scope, key, request_hash, response_status, response_body, completed_at, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: inspections; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.inspections (id, vehicle_id, repair_order_id, inspected_by_id, type, mileage, overall_condition, items, notes, created_at, updated_at, public_token, sent_at, customer_signature_url, customer_signed_at, customer_signer_name, customer_ip) FROM stdin;
1	1	\N	1	Multi-Point Inspection	62400	good	[{"label": "Engine Oil Level", "notes": "Changed today", "status": "ok"}, {"label": "Tire Tread Depth", "status": "ok"}, {"label": "Brake Pads Front", "status": "ok"}, {"label": "Brake Pads Rear", "notes": "20% remaining, monitor", "status": "needs_attention"}, {"label": "Air Filter", "status": "ok"}, {"label": "Battery", "notes": "73% health", "status": "ok"}, {"label": "Lights", "status": "ok"}, {"label": "Windshield Wipers", "notes": "Starting to streak", "status": "needs_attention"}]	Overall vehicle in good condition	2026-03-30 03:53:55.037199	2026-03-31 03:53:55.037199	\N	\N	\N	\N	\N	\N
2	5	\N	3	Pre-Service Inspection	91200	fair	[{"label": "Engine Oil Level", "notes": "Low - needs change", "status": "urgent"}, {"label": "Spark Plugs", "notes": "Replaced during service", "status": "urgent"}, {"label": "Air Filter", "status": "needs_attention"}, {"label": "Brake Pads Front", "status": "ok"}, {"label": "Tire Pressure", "notes": "All tires 5 PSI low", "status": "needs_attention"}]	Several items addressed during service	2026-03-28 03:53:55.037199	2026-03-31 03:53:55.037199	\N	\N	\N	\N	\N	\N
3	2	\N	\N	Multi-Point Inspection	\N	good	[{"label": "TtTurakes", "status": "ok"}, {"label": "Tires", "status": "ok"}, {"label": "Fluids", "status": "ok"}, {"label": "Ty", "status": "ok"}]	\N	2026-03-31 04:20:36.537118	2026-03-31 04:20:36.537118	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: inventory; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.inventory (id, part_number, name, description, category, vendor, cost_price, sell_price, quantity, min_quantity, location, notes, created_at, updated_at, compatible_vehicles, preferred_supplier_id, default_warranty_months, default_warranty_miles, square_catalog_object_id, square_location_id) FROM stdin;
1	OIL-5W30-5QT	Mobil 1 5W-30 Motor Oil 5Qt	\N	Oil & Fluids	AutoParts Plus	18.50	34.99	48	10	Aisle A-1	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
2	FLT-OIL-01234	Standard Oil Filter	\N	Filters	AutoParts Plus	4.25	9.99	85	20	Aisle A-2	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
3	BRK-PAD-FRT	Premium Front Brake Pads	\N	Brakes	NAPA Auto Parts	22.00	59.99	12	5	Aisle B-3	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
4	BRK-RTR-FRT	OEM Front Brake Rotor	\N	Brakes	NAPA Auto Parts	38.00	89.99	7	3	Aisle B-4	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
5	SRK-PLG-IRID	Iridium Spark Plugs (Set of 4)	\N	Ignition	NGK	28.00	54.99	30	8	Aisle C-1	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
6	FLT-AIR-HON	Honda Air Filter	\N	Filters	Honda OEM	14.00	29.99	3	5	Aisle A-3	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
7	TRN-FLD-ATF	Dexron VI ATF Transmission Fluid	\N	Oil & Fluids	AutoParts Plus	8.00	16.99	24	6	Aisle A-4	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
8	TRS-BLT-SERP	Serpentine Belt	\N	Belts & Hoses	Gates	16.00	38.99	2	4	Aisle D-2	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N	\N	\N	\N	\N	\N
9	3445	Alternator 	\N	Charging system	\N	0.00	0.00	0	5	\N	\N	2026-04-01 04:05:04.170012	2026-04-01 04:05:04.170012	\N	\N	\N	\N	\N	\N
10		Front brake pads 	\N	Brakes		0.00	0.00	0	5			2026-04-01 04:28:35.594594	2026-04-01 04:28:35.594594	Toyota camery 2008-2026	\N	\N	\N	\N	\N
11	BP-T33	TASK33 Brake Pad	\N	Brakes		20.00	50.00	5	1			2026-05-05 01:27:56.650432	2026-07-04 17:20:24.944		\N	12	12000	\N	\N
\.


--
-- Data for Name: invoice_items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.invoice_items (id, invoice_id, source_work_item_id, "position", kind, description, quantity, unit_price, unit_cost, line_total) FROM stdin;
\.


--
-- Data for Name: invoices; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.invoices (id, invoice_number, repair_order_id, customer_snapshot, vehicle_snapshot, status, notes, subtotal, tax_rate_bps, tax_amount, total, amount_paid, balance, tax_exempt, tax_exempt_number, public_token, issued_at, issued_by_id, voided_at, voided_by_id, void_reason, version, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: messages; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.messages (id, customer_id, repair_order_id, estimate_id, invoice_id, direction, channel, from_number, to_number, body, status, failure_reason, twilio_sid, read_at, sent_by_user_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: njmvc_categories; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.njmvc_categories (id, name, sort_order, active, notes, created_at, updated_at) FROM stdin;
1	Brake System	0	t	\N	2026-04-09 03:44:08.871612	2026-04-09 03:44:08.871612
2	Brake Linings	1	t	\N	2026-04-09 03:44:08.913326	2026-04-09 03:44:08.913326
3	Lighting Devices	2	t	\N	2026-04-09 03:44:08.91969	2026-04-09 03:44:08.91969
4	Glass/Glazing	3	t	\N	2026-04-09 03:44:08.926664	2026-04-09 03:44:08.926664
5	Doors	4	t	\N	2026-04-09 03:44:08.933307	2026-04-09 03:44:08.933307
6	Fuel System	5	t	\N	2026-04-09 03:44:08.948358	2026-04-09 03:44:08.948358
7	Tires	6	t	\N	2026-04-09 03:44:08.955351	2026-04-09 03:44:08.955351
8	Steering Mechanism	7	t	\N	2026-04-09 03:44:08.962579	2026-04-09 03:44:08.962579
9	Safety Equipment (If Applicable)	8	t	\N	2026-04-09 03:44:08.969387	2026-04-09 03:44:08.969387
10	Underbody	9	t	\N	2026-04-09 03:44:08.97526	2026-04-09 03:44:08.97526
11	Wipers	10	t	\N	2026-04-09 03:44:08.981088	2026-04-09 03:44:08.981088
12	Exhaust System	11	t	\N	2026-04-09 03:44:08.986693	2026-04-09 03:44:08.986693
13	Transmission	12	t	\N	2026-04-09 03:44:08.992573	2026-04-09 03:44:08.992573
14	Bus Exterior	13	t	\N	2026-04-09 03:44:08.997823	2026-04-09 03:44:08.997823
15	Underhood	14	t	\N	2026-04-09 03:44:09.00291	2026-04-09 03:44:09.00291
16	Emergency Exit	15	t	\N	2026-04-09 03:44:09.008143	2026-04-09 03:44:09.008143
17	Bus Interior	16	t	\N	2026-04-09 03:44:09.013284	2026-04-09 03:44:09.013284
18	Differential	17	t	\N	2026-04-09 03:44:09.019569	2026-04-09 03:44:09.019569
19	Mirrors	18	t	\N	2026-04-09 03:44:09.024679	2026-04-09 03:44:09.024679
20	Handicapped (If Applicable)	19	t	\N	2026-04-09 03:44:09.030236	2026-04-09 03:44:09.030236
\.


--
-- Data for Name: njmvc_inspection_results; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.njmvc_inspection_results (id, inspection_id, item_id, status, repaired_date, measurement_value, notes, created_at) FROM stdin;
189	2	1	ok	\N	\N	\N	2026-04-09 05:20:29.203331
190	2	2	ok	\N	\N	\N	2026-04-09 05:20:29.203331
191	2	3	ok	\N	\N	\N	2026-04-09 05:20:29.203331
192	2	4	ok	\N	\N	\N	2026-04-09 05:20:29.203331
193	2	5	ok	\N	\N	\N	2026-04-09 05:20:29.203331
194	2	6	ok	\N	\N	\N	2026-04-09 05:20:29.203331
195	2	7	ok	\N	\N	\N	2026-04-09 05:20:29.203331
196	2	8	ok	\N	\N	\N	2026-04-09 05:20:29.203331
197	2	9	ok	\N	\N	\N	2026-04-09 05:20:29.203331
198	2	10	ok	\N	\N	\N	2026-04-09 05:20:29.203331
199	2	11	ok	\N	\N	\N	2026-04-09 05:20:29.203331
200	2	12	ok	\N	\N	\N	2026-04-09 05:20:29.203331
201	2	13	ok	\N	\N	\N	2026-04-09 05:20:29.203331
202	2	14	ok	\N	\N	\N	2026-04-09 05:20:29.203331
203	2	15	ok	\N	\N	\N	2026-04-09 05:20:29.203331
204	2	16	needs_repair	2026-03-03	\N	\N	2026-04-09 05:20:29.203331
205	2	17	ok	\N	\N	\N	2026-04-09 05:20:29.203331
206	2	18	ok	\N	\N	\N	2026-04-09 05:20:29.203331
207	2	19	ok	\N	\N	\N	2026-04-09 05:20:29.203331
208	2	20	ok	\N	\N	\N	2026-04-09 05:20:29.203331
209	2	21	ok	\N	\N	\N	2026-04-09 05:20:29.203331
210	2	22	ok	\N	\N	\N	2026-04-09 05:20:29.203331
211	2	23	ok	\N	\N	\N	2026-04-09 05:20:29.203331
212	2	24	ok	\N	\N	\N	2026-04-09 05:20:29.203331
213	2	25	ok	\N	\N	\N	2026-04-09 05:20:29.203331
214	2	26	ok	\N	\N	\N	2026-04-09 05:20:29.203331
215	2	27	ok	\N	\N	\N	2026-04-09 05:20:29.203331
216	2	28	ok	\N	\N	\N	2026-04-09 05:20:29.203331
217	2	29	ok	\N	\N	\N	2026-04-09 05:20:29.203331
218	2	30	ok	\N	\N	\N	2026-04-09 05:20:29.203331
219	2	31	ok	\N	\N	\N	2026-04-09 05:20:29.203331
220	2	32	ok	\N	\N	\N	2026-04-09 05:20:29.203331
221	2	33	ok	\N	\N	\N	2026-04-09 05:20:29.203331
222	2	34	ok	\N	\N	\N	2026-04-09 05:20:29.203331
223	2	35	ok	\N	\N	\N	2026-04-09 05:20:29.203331
224	2	36	ok	\N	\N	\N	2026-04-09 05:20:29.203331
225	2	37	ok	\N	\N	\N	2026-04-09 05:20:29.203331
226	2	38	ok	\N	\N	\N	2026-04-09 05:20:29.203331
227	2	39	ok	\N	\N	\N	2026-04-09 05:20:29.203331
228	2	40	ok	\N	\N	\N	2026-04-09 05:20:29.203331
229	2	41	ok	\N	\N	\N	2026-04-09 05:20:29.203331
230	2	42	ok	\N	\N	\N	2026-04-09 05:20:29.203331
231	2	43	ok	\N	\N	\N	2026-04-09 05:20:29.203331
232	2	44	ok	\N	\N	\N	2026-04-09 05:20:29.203331
233	2	45	ok	\N	\N	\N	2026-04-09 05:20:29.203331
234	2	46	ok	\N	\N	\N	2026-04-09 05:20:29.203331
235	2	47	ok	\N	\N	\N	2026-04-09 05:20:29.203331
236	2	48	ok	\N	\N	\N	2026-04-09 05:20:29.203331
237	2	49	ok	\N	\N	\N	2026-04-09 05:20:29.203331
238	2	50	ok	\N	\N	\N	2026-04-09 05:20:29.203331
239	2	51	ok	\N	\N	\N	2026-04-09 05:20:29.203331
240	2	52	ok	\N	\N	\N	2026-04-09 05:20:29.203331
241	2	53	ok	\N	\N	\N	2026-04-09 05:20:29.203331
242	2	54	ok	\N	\N	\N	2026-04-09 05:20:29.203331
243	2	55	ok	\N	\N	\N	2026-04-09 05:20:29.203331
244	2	56	ok	\N	\N	\N	2026-04-09 05:20:29.203331
245	2	57	ok	\N	\N	\N	2026-04-09 05:20:29.203331
246	2	58	needs_repair	2026-04-02	\N	\N	2026-04-09 05:20:29.203331
247	2	59	ok	\N	\N	\N	2026-04-09 05:20:29.203331
248	2	60	ok	\N	\N	\N	2026-04-09 05:20:29.203331
249	2	61	ok	\N	\N	\N	2026-04-09 05:20:29.203331
250	2	62	ok	\N	\N	\N	2026-04-09 05:20:29.203331
251	2	63	ok	\N	\N	\N	2026-04-09 05:20:29.203331
252	2	64	ok	\N	\N	\N	2026-04-09 05:20:29.203331
253	2	65	ok	\N	\N	\N	2026-04-09 05:20:29.203331
254	2	66	ok	\N	\N	\N	2026-04-09 05:20:29.203331
255	2	67	ok	\N	\N	\N	2026-04-09 05:20:29.203331
256	2	68	ok	\N	\N	\N	2026-04-09 05:20:29.203331
257	2	69	ok	\N	\N	\N	2026-04-09 05:20:29.203331
258	2	70	ok	\N	\N	\N	2026-04-09 05:20:29.203331
259	2	71	ok	\N	\N	\N	2026-04-09 05:20:29.203331
260	2	72	ok	\N	\N	\N	2026-04-09 05:20:29.203331
261	2	73	ok	\N	\N	\N	2026-04-09 05:20:29.203331
262	2	74	ok	\N	\N	\N	2026-04-09 05:20:29.203331
263	2	75	ok	\N	\N	\N	2026-04-09 05:20:29.203331
264	2	76	ok	\N	\N	\N	2026-04-09 05:20:29.203331
265	2	77	ok	\N	\N	\N	2026-04-09 05:20:29.203331
266	2	78	ok	\N	\N	\N	2026-04-09 05:20:29.203331
267	2	79	ok	\N	\N	\N	2026-04-09 05:20:29.203331
268	2	80	ok	\N	\N	\N	2026-04-09 05:20:29.203331
269	2	81	ok	\N	\N	\N	2026-04-09 05:20:29.203331
270	2	82	ok	\N	\N	\N	2026-04-09 05:20:29.203331
271	2	83	ok	\N	\N	\N	2026-04-09 05:20:29.203331
272	2	84	ok	\N	\N	\N	2026-04-09 05:20:29.203331
273	2	85	ok	\N	\N	\N	2026-04-09 05:20:29.203331
274	2	86	ok	\N	\N	\N	2026-04-09 05:20:29.203331
275	2	87	na	\N	\N	\N	2026-04-09 05:20:29.203331
276	2	88	na	\N	\N	\N	2026-04-09 05:20:29.203331
277	2	89	na	\N	\N	\N	2026-04-09 05:20:29.203331
278	2	90	na	\N	\N	\N	2026-04-09 05:20:29.203331
279	2	91	na	\N	\N	\N	2026-04-09 05:20:29.203331
280	2	92	na	\N	\N	\N	2026-04-09 05:20:29.203331
281	2	93	na	\N	\N	\N	2026-04-09 05:20:29.203331
95	1	1	ok	\N	\N	\N	2026-04-09 05:00:34.882235
96	1	2	ok	\N	\N	\N	2026-04-09 05:00:34.882235
97	1	3	needs_repair	2026-04-03	\N	\N	2026-04-09 05:00:34.882235
98	1	4	ok	\N	\N	\N	2026-04-09 05:00:34.882235
99	1	5	ok	\N	\N	\N	2026-04-09 05:00:34.882235
100	1	6	ok	\N	\N	\N	2026-04-09 05:00:34.882235
101	1	7	ok	\N	\N	\N	2026-04-09 05:00:34.882235
102	1	8	ok	\N	\N	\N	2026-04-09 05:00:34.882235
103	1	9	ok	\N	\N	\N	2026-04-09 05:00:34.882235
104	1	10	ok	\N	\N	\N	2026-04-09 05:00:34.882235
105	1	11	ok	\N	\N	\N	2026-04-09 05:00:34.882235
106	1	12	needs_repair	2026-03-04	\N	\N	2026-04-09 05:00:34.882235
107	1	13	ok	\N	\N	\N	2026-04-09 05:00:34.882235
108	1	14	ok	\N	\N	\N	2026-04-09 05:00:34.882235
109	1	15	ok	\N	\N	\N	2026-04-09 05:00:34.882235
110	1	16	ok	\N	\N	\N	2026-04-09 05:00:34.882235
111	1	17	ok	\N	\N	\N	2026-04-09 05:00:34.882235
112	1	18	ok	\N	\N	\N	2026-04-09 05:00:34.882235
113	1	19	ok	\N	\N	\N	2026-04-09 05:00:34.882235
114	1	20	ok	\N	\N	\N	2026-04-09 05:00:34.882235
115	1	21	ok	\N	\N	\N	2026-04-09 05:00:34.882235
116	1	22	ok	\N	\N	\N	2026-04-09 05:00:34.882235
117	1	23	ok	\N	\N	\N	2026-04-09 05:00:34.882235
118	1	24	ok	\N	\N	\N	2026-04-09 05:00:34.882235
119	1	25	ok	\N	\N	\N	2026-04-09 05:00:34.882235
120	1	26	ok	\N	\N	\N	2026-04-09 05:00:34.882235
121	1	27	ok	\N	\N	\N	2026-04-09 05:00:34.882235
122	1	28	ok	\N	\N	\N	2026-04-09 05:00:34.882235
123	1	29	ok	\N	\N	\N	2026-04-09 05:00:34.882235
124	1	30	ok	\N	\N	\N	2026-04-09 05:00:34.882235
125	1	31	ok	\N	\N	\N	2026-04-09 05:00:34.882235
126	1	32	ok	\N	\N	\N	2026-04-09 05:00:34.882235
127	1	33	ok	\N	\N	\N	2026-04-09 05:00:34.882235
128	1	34	ok	\N	\N	\N	2026-04-09 05:00:34.882235
129	1	35	ok	\N	\N	\N	2026-04-09 05:00:34.882235
130	1	36	ok	\N	\N	\N	2026-04-09 05:00:34.882235
131	1	37	ok	\N	\N	\N	2026-04-09 05:00:34.882235
132	1	38	ok	\N	\N	\N	2026-04-09 05:00:34.882235
133	1	39	ok	\N	\N	\N	2026-04-09 05:00:34.882235
134	1	40	ok	\N	\N	\N	2026-04-09 05:00:34.882235
135	1	41	ok	\N	\N	\N	2026-04-09 05:00:34.882235
136	1	42	ok	\N	\N	\N	2026-04-09 05:00:34.882235
137	1	43	ok	\N	\N	\N	2026-04-09 05:00:34.882235
138	1	44	ok	\N	\N	\N	2026-04-09 05:00:34.882235
139	1	45	ok	\N	\N	\N	2026-04-09 05:00:34.882235
140	1	46	ok	\N	\N	\N	2026-04-09 05:00:34.882235
141	1	47	ok	\N	\N	\N	2026-04-09 05:00:34.882235
142	1	48	ok	\N	\N	\N	2026-04-09 05:00:34.882235
143	1	49	ok	\N	\N	\N	2026-04-09 05:00:34.882235
144	1	50	ok	\N	\N	\N	2026-04-09 05:00:34.882235
145	1	51	ok	\N	\N	\N	2026-04-09 05:00:34.882235
146	1	52	ok	\N	\N	\N	2026-04-09 05:00:34.882235
147	1	53	ok	\N	\N	\N	2026-04-09 05:00:34.882235
148	1	54	ok	\N	\N	\N	2026-04-09 05:00:34.882235
149	1	55	ok	\N	\N	\N	2026-04-09 05:00:34.882235
150	1	56	ok	\N	\N	\N	2026-04-09 05:00:34.882235
151	1	57	ok	\N	\N	\N	2026-04-09 05:00:34.882235
152	1	58	ok	\N	\N	\N	2026-04-09 05:00:34.882235
153	1	59	ok	\N	\N	\N	2026-04-09 05:00:34.882235
154	1	60	ok	\N	\N	\N	2026-04-09 05:00:34.882235
155	1	61	ok	\N	\N	\N	2026-04-09 05:00:34.882235
156	1	62	ok	\N	\N	\N	2026-04-09 05:00:34.882235
157	1	63	ok	\N	\N	\N	2026-04-09 05:00:34.882235
158	1	64	ok	\N	\N	\N	2026-04-09 05:00:34.882235
159	1	65	ok	\N	\N	\N	2026-04-09 05:00:34.882235
160	1	66	ok	\N	\N	\N	2026-04-09 05:00:34.882235
161	1	67	ok	\N	\N	\N	2026-04-09 05:00:34.882235
162	1	68	ok	\N	\N	\N	2026-04-09 05:00:34.882235
163	1	69	ok	\N	\N	\N	2026-04-09 05:00:34.882235
164	1	70	ok	\N	\N	\N	2026-04-09 05:00:34.882235
165	1	71	ok	\N	\N	\N	2026-04-09 05:00:34.882235
166	1	72	ok	\N	\N	\N	2026-04-09 05:00:34.882235
167	1	73	ok	\N	\N	\N	2026-04-09 05:00:34.882235
168	1	74	ok	\N	\N	\N	2026-04-09 05:00:34.882235
169	1	75	ok	\N	\N	\N	2026-04-09 05:00:34.882235
170	1	76	ok	\N	\N	\N	2026-04-09 05:00:34.882235
171	1	77	ok	\N	\N	\N	2026-04-09 05:00:34.882235
172	1	78	ok	\N	\N	\N	2026-04-09 05:00:34.882235
173	1	79	ok	\N	\N	\N	2026-04-09 05:00:34.882235
174	1	80	ok	\N	\N	\N	2026-04-09 05:00:34.882235
175	1	81	ok	\N	\N	\N	2026-04-09 05:00:34.882235
176	1	82	ok	\N	\N	\N	2026-04-09 05:00:34.882235
177	1	83	ok	\N	\N	\N	2026-04-09 05:00:34.882235
178	1	84	ok	\N	\N	\N	2026-04-09 05:00:34.882235
179	1	85	ok	\N	\N	\N	2026-04-09 05:00:34.882235
180	1	86	ok	\N	\N	\N	2026-04-09 05:00:34.882235
181	1	87	ok	\N	\N	\N	2026-04-09 05:00:34.882235
182	1	88	ok	\N	\N	\N	2026-04-09 05:00:34.882235
183	1	89	ok	\N	\N	\N	2026-04-09 05:00:34.882235
184	1	90	ok	\N	\N	\N	2026-04-09 05:00:34.882235
185	1	91	ok	\N	\N	\N	2026-04-09 05:00:34.882235
186	1	92	ok	\N	\N	\N	2026-04-09 05:00:34.882235
187	1	93	ok	\N	\N	\N	2026-04-09 05:00:34.882235
188	1	94	ok	\N	\N	\N	2026-04-09 05:00:34.882235
282	2	94	na	\N	\N	\N	2026-04-09 05:20:29.203331
\.


--
-- Data for Name: njmvc_inspections; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.njmvc_inspections (id, vehicle_id, operator_name, address, mechanic_name_print, mechanic_name_signed, report_number, fleet_unit_number, mileage, vehicle_type, vin, license_plate, inspection_date, certified_passed, notes, created_at, updated_at, purchase_date) FROM stdin;
1	1	Classy Transfers 		Nabil Aly		2	4	145000	SV	1HGCM82633A004352	KXP-4521	2026-04-09	t		2026-04-09 04:59:35.142567	2026-04-09 05:00:34.856	\N
2	2	Classy Transfers 		Nabil Aly 		5	4	135000	SV	2T1BURHE0JC078901	RMQ-7733	2026-04-09	t		2026-04-09 05:20:29.026013	2026-04-09 05:20:29.026013	\N
\.


--
-- Data for Name: njmvc_items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.njmvc_items (id, category_id, label, has_measurement, measurement_unit, sort_order, active, created_at, measurement_position) FROM stdin;
1	1	a. Service Brakes	f	\N	0	t	2026-04-09 03:44:08.909163	\N
2	1	b. Parking Brake System	f	\N	1	t	2026-04-09 03:44:08.909163	\N
3	1	c. Brake Drums or Rotors	f	\N	2	t	2026-04-09 03:44:08.909163	\N
4	1	d. Brake Hose	f	\N	3	t	2026-04-09 03:44:08.909163	\N
5	1	e. Brake Tubing	f	\N	4	t	2026-04-09 03:44:08.909163	\N
6	1	f. Low Pressure Warning	f	\N	5	t	2026-04-09 03:44:08.909163	\N
7	1	g. Air Compressor	f	\N	6	t	2026-04-09 03:44:08.909163	\N
8	1	h. Vacuum Systems	f	\N	7	t	2026-04-09 03:44:08.909163	\N
9	1	i. Electric Brakes	f	\N	8	t	2026-04-09 03:44:08.909163	\N
10	1	j. Hydraulic Brakes	f	\N	9	t	2026-04-09 03:44:08.909163	\N
11	2	a. L/F	t	mm	0	t	2026-04-09 03:44:08.916981	\N
12	2	b. R/F	t	mm	1	t	2026-04-09 03:44:08.916981	\N
13	2	c. L/R	t	mm	2	t	2026-04-09 03:44:08.916981	\N
14	2	d. R/R	t	mm	3	t	2026-04-09 03:44:08.916981	\N
15	3	a. Headlights	f	\N	0	t	2026-04-09 03:44:08.923629	\N
16	3	b. Tail Lights	f	\N	1	t	2026-04-09 03:44:08.923629	\N
17	3	c. Turn Signals	f	\N	2	t	2026-04-09 03:44:08.923629	\N
18	3	d. Marker/Clearance	f	\N	3	t	2026-04-09 03:44:08.923629	\N
19	3	e. School Bus Warning	f	\N	4	t	2026-04-09 03:44:08.923629	\N
20	3	f. Indicator	f	\N	5	t	2026-04-09 03:44:08.923629	\N
21	3	g. Stop Arm/Crossing Arm	f	\N	6	t	2026-04-09 03:44:08.923629	\N
22	3	h. Back Up Alarm	f	\N	7	t	2026-04-09 03:44:08.923629	\N
23	4	a. Cracks	f	\N	0	t	2026-04-09 03:44:08.930327	\N
24	4	b. Discoloration	f	\N	1	t	2026-04-09 03:44:08.930327	\N
25	4	c. Vision Obstruction	f	\N	2	t	2026-04-09 03:44:08.930327	\N
26	5	a. Entry Steps	f	\N	0	t	2026-04-09 03:44:08.937074	\N
27	5	b. Stepwell Light	f	\N	1	t	2026-04-09 03:44:08.937074	\N
28	5	c. Door Seals	f	\N	2	t	2026-04-09 03:44:08.937074	\N
29	5	d. Grab Handles	f	\N	3	t	2026-04-09 03:44:08.937074	\N
30	6	a. Visible Leak	f	\N	0	t	2026-04-09 03:44:08.952026	\N
31	6	b. Fuel Tank Filler Cap Missing	f	\N	1	t	2026-04-09 03:44:08.952026	\N
32	6	c. Fuel Tank Mounting	f	\N	2	t	2026-04-09 03:44:08.952026	\N
33	7	a. Size	f	\N	0	t	2026-04-09 03:44:08.959091	\N
34	7	b. No. of Ply	f	\N	1	t	2026-04-09 03:44:08.959091	\N
35	7	c. L/F	t	/32"	2	t	2026-04-09 03:44:08.959091	\N
36	7	d. R/F	t	/32"	3	t	2026-04-09 03:44:08.959091	\N
37	7	e. R/R/O	t	/32"	4	t	2026-04-09 03:44:08.959091	\N
38	7	f. R/R/I	t	/32"	5	t	2026-04-09 03:44:08.959091	\N
39	7	g. L/R/I	t	/32"	6	t	2026-04-09 03:44:08.959091	\N
40	7	h. L/R/O	t	/32"	7	t	2026-04-09 03:44:08.959091	\N
41	8	a. Steering System	f	\N	0	t	2026-04-09 03:44:08.965895	\N
42	8	b. Steering Column	f	\N	1	t	2026-04-09 03:44:08.965895	\N
43	8	c. Power Steering	f	\N	2	t	2026-04-09 03:44:08.965895	\N
44	9	a. Fire Extinguisher	f	\N	0	t	2026-04-09 03:44:08.972459	\N
45	9	b. First Aid Kit	f	\N	1	t	2026-04-09 03:44:08.972459	\N
46	9	c. Portable Warning Device	f	\N	2	t	2026-04-09 03:44:08.972459	\N
47	9	d. Wrecking Bar	f	\N	3	t	2026-04-09 03:44:08.972459	\N
48	10	a. Drive Shaft/Guards	f	\N	0	t	2026-04-09 03:44:08.977751	\N
49	10	b. Spring Assembly	f	\N	1	t	2026-04-09 03:44:08.977751	\N
50	10	c. Crossmembers	f	\N	2	t	2026-04-09 03:44:08.977751	\N
51	10	d. Body Clips/Bolts	f	\N	3	t	2026-04-09 03:44:08.977751	\N
52	10	e. Shocks	f	\N	4	t	2026-04-09 03:44:08.977751	\N
53	10	f. Fluid Leaks	f	\N	5	t	2026-04-09 03:44:08.977751	\N
54	10	g. Undercoating	f	\N	6	t	2026-04-09 03:44:08.977751	\N
55	10	h. Carrier Bearings	f	\N	7	t	2026-04-09 03:44:08.977751	\N
56	11	a. Wiper Inoperable	f	\N	0	t	2026-04-09 03:44:08.984495	\N
57	11	b. Washer Inoperable	f	\N	1	t	2026-04-09 03:44:08.984495	\N
58	11	c. Wiper Blades	f	\N	2	t	2026-04-09 03:44:08.984495	\N
59	11	d. Wiper Sweep	f	\N	3	t	2026-04-09 03:44:08.984495	\N
60	12	a. Mounting	f	\N	0	t	2026-04-09 03:44:08.990204	\N
61	12	b. Leaks	f	\N	1	t	2026-04-09 03:44:08.990204	\N
62	13	Transmission	f	\N	0	t	2026-04-09 03:44:08.995254	\N
63	14	a. Condition	f	\N	0	t	2026-04-09 03:44:09.00028	\N
64	14	b. Bumpers	f	\N	1	t	2026-04-09 03:44:09.00028	\N
65	14	c. Rub Rails	f	\N	2	t	2026-04-09 03:44:09.00028	\N
66	15	a. Belts	f	\N	0	t	2026-04-09 03:44:09.005778	\N
67	15	b. Hoses	f	\N	1	t	2026-04-09 03:44:09.005778	\N
68	15	c. Battery	f	\N	2	t	2026-04-09 03:44:09.005778	\N
69	15	d. Antifreeze Leak	f	\N	3	t	2026-04-09 03:44:09.005778	\N
70	15	e. Oil Leak	f	\N	4	t	2026-04-09 03:44:09.005778	\N
71	16	a. Lettering	f	\N	0	t	2026-04-09 03:44:09.010438	\N
72	16	b. Buzzers	f	\N	1	t	2026-04-09 03:44:09.010438	\N
73	16	c. Landing Lights	f	\N	2	t	2026-04-09 03:44:09.010438	\N
74	16	d. Door Slide Bar	f	\N	3	t	2026-04-09 03:44:09.010438	\N
75	16	e. Door Handles	f	\N	4	t	2026-04-09 03:44:09.010438	\N
76	17	a. Instruments	f	\N	0	t	2026-04-09 03:44:09.016558	\N
77	17	b. Heaters	f	\N	1	t	2026-04-09 03:44:09.016558	\N
78	17	c. Defrosters	f	\N	2	t	2026-04-09 03:44:09.016558	\N
79	17	d. Lights	f	\N	3	t	2026-04-09 03:44:09.016558	\N
80	17	e. Cleanliness	f	\N	4	t	2026-04-09 03:44:09.016558	\N
81	17	f. Seats	f	\N	5	t	2026-04-09 03:44:09.016558	\N
82	18	Differential	f	\N	0	t	2026-04-09 03:44:09.021974	\N
83	19	a. Crossover	f	\N	0	t	2026-04-09 03:44:09.027005	\N
84	19	b. Rearview/Convex	f	\N	1	t	2026-04-09 03:44:09.027005	\N
85	19	c. Interior	f	\N	2	t	2026-04-09 03:44:09.027005	\N
86	19	d. Mirror Adjustment	f	\N	3	t	2026-04-09 03:44:09.027005	\N
87	20	a. Power Lift	f	\N	0	t	2026-04-09 03:44:09.03325	\N
88	20	b. Lift Door	f	\N	1	t	2026-04-09 03:44:09.03325	\N
89	20	c. Buzzer	f	\N	2	t	2026-04-09 03:44:09.03325	\N
90	20	d. Interlock	f	\N	3	t	2026-04-09 03:44:09.03325	\N
91	20	e. Identification	f	\N	4	t	2026-04-09 03:44:09.03325	\N
92	20	f. Light	f	\N	5	t	2026-04-09 03:44:09.03325	\N
93	20	g. Fluid Leaks	f	\N	6	t	2026-04-09 03:44:09.03325	\N
94	20	h. Manual Pump	f	\N	7	t	2026-04-09 03:44:09.03325	\N
\.


--
-- Data for Name: password_reset_tokens; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.password_reset_tokens (id, employee_id, token_hash, expires_at, used_at, created_at) FROM stdin;
1	9	aec64a941bce3cb34f8bea01f220a3295f6993d9611555f3d136255ea2a65a93	2026-09-05 01:57:24.756	2026-09-05 01:30:35.493	2026-09-05 01:27:24.768695
2	9	e5b7a4e3af3aaf2a2df1531778340004ceb37aa6e97bb3119d28497c91eaae1e	2026-09-05 02:00:35.493	2026-09-05 03:15:36.219	2026-09-05 01:30:35.510189
3	9	a3f572f6dccc4800bc097d9af66e9749a3fde72d985e30f4f03f9d7fdf4945a7	2026-09-05 03:45:36.219	\N	2026-09-05 03:15:36.360176
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.payments (id, invoice_id, amount, status, method, processor, processor_payment_id, processor_event_id, attempt_key, idempotency_key, parent_payment_id, reference_number, failure_reason, refunded_at, voided_at, processed_at, created_at) FROM stdin;
\.


--
-- Data for Name: processor_webhook_receipts; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.processor_webhook_receipts (id, processor, event_id, event_type, payload, received_at, processed_at, failure_reason) FROM stdin;
\.


--
-- Data for Name: purchase_line_items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.purchase_line_items (id, purchase_id, item_type, inventory_id, used_car_id, description, quantity, unit_cost, notes, created_at) FROM stdin;
1	1	inventory	10	\N	Front brake pads 	1.00	35.00	\N	2026-04-18 22:15:44.717058
\.


--
-- Data for Name: purchases; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.purchases (id, supplier_legacy, supplier_contact, supplier_email, supplier_phone, invoice_number, amount, tax, shipping, status, purchase_date, notes, invoice_file_path, invoice_file_name, invoice_file_type, created_at, updated_at, supplier_id) FROM stdin;
1	Amazon					35.00	0.00	0.00	received	2026-04-16	Dodge caravan 	\N	\N	\N	2026-04-18 22:15:44.679702	2026-04-18 22:15:44.679702	1
\.


--
-- Data for Name: reminders; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.reminders (id, customer_id, vehicle_id, service_type, due_date, due_mileage, sent, sent_at, notes, created_at, updated_at) FROM stdin;
1	1	1	Oil Change	2026-04-30	65000	f	\N	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
2	3	4	Tire Rotation	2026-04-15	46000	f	\N	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
3	4	5	Annual Inspection	2026-03-26	93000	f	\N	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
4	2	2	Brake Fluid Flush	2026-05-30	35000	t	\N	\N	2026-03-31 03:53:55.037199	2026-03-31 03:53:55.037199
5	6	9	Brake Inspection	2027-05-05	\N	f	\N	Auto-created from repair order RO-1011	2026-05-05 01:29:47.846011	2026-05-05 01:29:47.846011
\.


--
-- Data for Name: repair_order_events; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.repair_order_events (id, repair_order_id, event_type, actor_id, actor_label, payload, occurred_at) FROM stdin;
\.


--
-- Data for Name: repair_order_work_items; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.repair_order_work_items (id, repair_order_id, source_estimate_item_id, "position", kind, description, quantity, unit_price, unit_cost, estimated_hours, status, authorized_at, performed_at, performed_by_id, voided_at, void_reason, created_at) FROM stdin;
\.


--
-- Data for Name: repair_orders; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.repair_orders (id, order_number, customer_id, vehicle_id, used_car_id, internal, assigned_to_id, created_by_id, status, priority, complaint, diagnosis, notes, mileage_in, mileage_out, promised_at, opened_at, completed_at, cancelled_at, cancellation_reason, version, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.role_permissions (id, role, resource, action) FROM stdin;
1	admin	dashboard	view
2	admin	dashboard	create
3	admin	dashboard	edit
4	admin	dashboard	delete
5	admin	dashboard	print
6	admin	repair_orders	view
7	admin	repair_orders	create
8	admin	repair_orders	edit
9	admin	repair_orders	delete
10	admin	repair_orders	print
11	admin	estimates	view
12	admin	estimates	create
13	admin	estimates	edit
14	admin	estimates	delete
15	admin	estimates	print
16	admin	invoices	view
17	admin	invoices	create
18	admin	invoices	edit
19	admin	invoices	delete
20	admin	invoices	print
21	admin	appointments	view
22	admin	appointments	create
23	admin	appointments	edit
24	admin	appointments	delete
25	admin	appointments	print
26	admin	inspections	view
27	admin	inspections	create
28	admin	inspections	edit
29	admin	inspections	delete
30	admin	inspections	print
31	admin	njmvc	view
32	admin	njmvc	create
33	admin	njmvc	edit
34	admin	njmvc	delete
35	admin	njmvc	print
36	admin	njmvc_template	view
37	admin	njmvc_template	create
38	admin	njmvc_template	edit
39	admin	njmvc_template	delete
40	admin	njmvc_template	print
41	admin	customers	view
42	admin	customers	create
43	admin	customers	edit
44	admin	customers	delete
45	admin	customers	print
46	admin	vehicles	view
47	admin	vehicles	create
48	admin	vehicles	edit
49	admin	vehicles	delete
50	admin	vehicles	print
51	admin	inventory	view
52	admin	inventory	create
53	admin	inventory	edit
54	admin	inventory	delete
55	admin	inventory	print
56	admin	payments	view
57	admin	payments	create
58	admin	payments	edit
59	admin	payments	delete
60	admin	payments	print
61	admin	used_cars	view
62	admin	used_cars	create
63	admin	used_cars	edit
64	admin	used_cars	delete
65	admin	used_cars	print
66	admin	purchases	view
67	admin	purchases	create
68	admin	purchases	edit
69	admin	purchases	delete
70	admin	purchases	print
71	admin	reports	view
72	admin	reports	create
73	admin	reports	edit
74	admin	reports	delete
75	admin	reports	print
76	admin	employees	view
77	admin	employees	create
78	admin	employees	edit
79	admin	employees	delete
80	admin	employees	print
81	admin	time_entries	view
82	admin	time_entries	create
83	admin	time_entries	edit
84	admin	time_entries	delete
85	admin	time_entries	print
86	admin	expenses	view
87	admin	expenses	create
88	admin	expenses	edit
89	admin	expenses	delete
90	admin	expenses	print
91	admin	reminders	view
92	admin	reminders	create
93	admin	reminders	edit
94	admin	reminders	delete
95	admin	reminders	print
96	admin	customer_categories	view
97	admin	customer_categories	create
98	admin	customer_categories	edit
99	admin	customer_categories	delete
100	admin	customer_categories	print
101	admin	users	view
102	admin	users	create
103	admin	users	edit
104	admin	users	delete
105	admin	users	print
106	admin	permissions	view
107	admin	permissions	create
108	admin	permissions	edit
109	admin	permissions	delete
110	admin	permissions	print
111	manager	dashboard	view
112	manager	repair_orders	view
113	manager	repair_orders	create
114	manager	repair_orders	edit
115	manager	repair_orders	delete
116	manager	repair_orders	print
117	manager	estimates	view
118	manager	estimates	create
119	manager	estimates	edit
120	manager	estimates	delete
121	manager	estimates	print
122	manager	invoices	view
123	manager	invoices	create
124	manager	invoices	edit
125	manager	invoices	delete
126	manager	invoices	print
127	manager	appointments	view
128	manager	appointments	create
129	manager	appointments	edit
130	manager	appointments	delete
131	manager	appointments	print
132	manager	inspections	view
133	manager	inspections	create
134	manager	inspections	edit
135	manager	inspections	delete
136	manager	inspections	print
137	manager	njmvc	view
138	manager	njmvc	create
139	manager	njmvc	edit
140	manager	njmvc	delete
141	manager	njmvc	print
142	manager	njmvc_template	view
143	manager	njmvc_template	edit
144	manager	customers	view
145	manager	customers	create
146	manager	customers	edit
147	manager	customers	delete
148	manager	customers	print
149	manager	vehicles	view
150	manager	vehicles	create
151	manager	vehicles	edit
152	manager	vehicles	delete
153	manager	vehicles	print
154	manager	inventory	view
155	manager	inventory	create
156	manager	inventory	edit
157	manager	inventory	delete
158	manager	inventory	print
159	manager	payments	view
160	manager	payments	create
161	manager	payments	edit
162	manager	payments	delete
163	manager	payments	print
164	manager	used_cars	view
165	manager	used_cars	create
166	manager	used_cars	edit
167	manager	used_cars	delete
168	manager	used_cars	print
169	manager	purchases	view
170	manager	purchases	create
171	manager	purchases	edit
172	manager	purchases	delete
173	manager	purchases	print
174	manager	reports	view
175	manager	reports	print
176	manager	employees	view
177	manager	employees	create
178	manager	employees	edit
179	manager	time_entries	view
180	manager	time_entries	create
181	manager	time_entries	edit
182	manager	expenses	view
183	manager	expenses	create
184	manager	expenses	edit
185	manager	reminders	view
186	manager	reminders	create
187	manager	reminders	edit
188	manager	customer_categories	view
189	manager	customer_categories	create
190	manager	customer_categories	edit
191	manager	users	view
192	manager	permissions	view
193	technician	dashboard	view
194	technician	repair_orders	view
195	technician	repair_orders	create
196	technician	repair_orders	edit
197	technician	repair_orders	print
198	technician	estimates	view
199	technician	invoices	view
200	technician	appointments	view
201	technician	inspections	view
202	technician	inspections	create
203	technician	inspections	edit
204	technician	njmvc	view
205	technician	njmvc	create
206	technician	njmvc	edit
207	technician	njmvc	print
208	technician	njmvc_template	view
209	technician	customers	view
210	technician	vehicles	view
211	technician	inventory	view
212	technician	inventory	edit
213	technician	time_entries	view
214	technician	time_entries	create
215	technician	time_entries	edit
216	technician	expenses	view
217	technician	reminders	view
218	inspector	dashboard	view
219	inspector	repair_orders	view
220	inspector	appointments	view
221	inspector	inspections	view
222	inspector	inspections	create
223	inspector	inspections	edit
224	inspector	inspections	print
225	inspector	njmvc	view
226	inspector	njmvc	create
227	inspector	njmvc	edit
228	inspector	njmvc	print
229	inspector	njmvc_template	view
230	inspector	customers	view
231	inspector	vehicles	view
232	inspector	time_entries	view
233	inspector	time_entries	edit
234	inspector	reminders	view
235	viewer	dashboard	view
236	viewer	repair_orders	view
237	viewer	estimates	view
238	viewer	invoices	view
239	viewer	appointments	view
240	viewer	inspections	view
241	viewer	njmvc	view
242	viewer	customers	view
243	viewer	vehicles	view
244	viewer	inventory	view
245	viewer	reminders	view
246	admin	canned_jobs	view
247	admin	canned_jobs	create
248	admin	canned_jobs	edit
249	admin	canned_jobs	delete
250	admin	canned_jobs	print
251	manager	canned_jobs	view
252	manager	canned_jobs	create
253	manager	canned_jobs	edit
254	manager	canned_jobs	delete
255	manager	canned_jobs	print
256	technician	canned_jobs	view
257	inspector	canned_jobs	view
258	viewer	canned_jobs	view
259	advisor	estimates	create
\.


--
-- Data for Name: shop_settings; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.shop_settings (id, labor_rate, updated_at, stripe_publishable_key, stripe_secret_key, stripe_webhook_secret, stripe_ach_enabled, twilio_account_sid, twilio_auth_token, twilio_from_number) FROM stdin;
1	95.00	2026-05-03 08:57:42.763	\N	\N	\N	f	AC_TEST_SID	fake-token-12345	+15555550100
\.


--
-- Data for Name: square_mappings; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.square_mappings (id, entity_type, local_id, square_id, square_version, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: square_sync_states; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.square_sync_states (id, resource, cursor, last_synced_at, last_error, updated_at) FROM stdin;
\.


--
-- Data for Name: square_webhook_events; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.square_webhook_events (id, square_event_id, event_type, payload, processed_at, failure_reason, received_at) FROM stdin;
\.


--
-- Data for Name: stock_movements; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.stock_movements (id, inventory_id, delta, reason, reference_table, reference_id, reference_line_id, unit_cost, notes, created_at, created_by_id, work_item_id) FROM stdin;
1	11	-1	ro_consumed	repair_orders	11	0	20.00	\N	2026-05-05 01:29:47.803437	\N	\N
2	11	1	ro_unconsumed	repair_orders	11	0	20.00	\N	2026-07-04 17:20:24.931681	\N	\N
\.


--
-- Data for Name: suppliers; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.suppliers (id, name, account_number, payment_terms, contact_name, contact_email, contact_phone, address, notes, archived, created_at, updated_at) FROM stdin;
1	Amazon	\N	\N				\N	\N	f	2026-05-03 12:15:28.257825	2026-05-03 12:15:28.257825
3	Acme-rw70kZ	AC-100	\N	\N	x@x.test	\N	123 Main St	\N	f	2026-05-03 12:29:26.022061	2026-05-03 12:30:01.03
\.


--
-- Data for Name: time_entries; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.time_entries (id, employee_id, repair_order_id, work_item_id, clock_in, clock_out, total_hours, notes, created_at) FROM stdin;
\.


--
-- Data for Name: used_cars; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.used_cars (id, vin, year, make, model, "trim", color, mileage, condition, purchase_price, selling_price, status, customer_id, purchase_date, sale_date, notes, created_at, updated_at, engine_type, transmission_type, buyer_id, sale_invoice_id, published) FROM stdin;
1		2023	Dodge 	Caravan 			\N	good	2000.00	\N	needs_work	\N	\N	\N	Transmission 	2026-05-28 04:06:35.907096	2026-05-28 04:06:35.907096			\N	\N	f
\.


--
-- Data for Name: user_board_preferences; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.user_board_preferences (id, user_id, board_key, column_order, hidden_columns, updated_at) FROM stdin;
\.


--
-- Data for Name: vehicles; Type: TABLE DATA; Schema: public; Owner: neondb_owner
--

COPY public.vehicles (id, customer_id, vin, license_plate, year, make, model, "trim", color, mileage, engine_type, transmission_type, notes, created_at, updated_at, fleet_number) FROM stdin;
1	1	1HGCM82633A004352	KXP-4521	2019	Honda	Accord	EX-L	Silver	62400	V6 3.5L	Automatic	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N
2	2	2T1BURHE0JC078901	RMQ-7733	2021	Toyota	Camry	SE	White	31200	I4 2.5L	Automatic	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N
3	2	3VWFE21C04M000001	BKL-1122	2018	Volkswagen	Jetta	S	Black	78900	I4 1.4L Turbo	Automatic	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N
4	3	1G1ZT53806F109149	TNF-9901	2020	Chevrolet	Malibu	LT	Blue	44100	I4 1.5L Turbo	Automatic	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N
5	4	JHMCG56631C001234	PMD-3388	2017	Honda	Civic	LX	Red	91200	I4 1.5L	CVT	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N
6	5	1FA6P8AM1F5388888	AXR-7654	2022	Ford	Mustang	GT	Gray	18300	V8 5.0L	Manual	\N	2026-03-31 03:52:54.047113	2026-03-31 03:52:54.047113	\N
9	6	\N	BUS-99	2018	Bluebird	Vision	\N	\N	\N	\N	\N	\N	2026-05-02 22:17:56.435571	2026-05-02 22:17:56.435571	\N
\.


--
-- Name: activity_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.activity_events_id_seq', 16, true);


--
-- Name: appointments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.appointments_id_seq', 7, true);


--
-- Name: attachments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.attachments_id_seq', 5, true);


--
-- Name: canned_jobs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.canned_jobs_id_seq', 1, true);


--
-- Name: customer_categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.customer_categories_id_seq', 1, true);


--
-- Name: customers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.customers_id_seq', 22, true);


--
-- Name: email_templates_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.email_templates_id_seq', 9, true);


--
-- Name: employees_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.employees_id_seq', 22, true);


--
-- Name: estimate_approval_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.estimate_approval_items_id_seq', 35, true);


--
-- Name: estimate_approvals_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.estimate_approvals_id_seq', 22, true);


--
-- Name: estimate_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.estimate_items_id_seq', 48, true);


--
-- Name: estimate_revisions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.estimate_revisions_id_seq', 32, true);


--
-- Name: expenses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.expenses_id_seq', 5, true);


--
-- Name: idempotency_keys_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.idempotency_keys_id_seq', 14, true);


--
-- Name: inspections_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.inspections_id_seq', 3, true);


--
-- Name: inventory_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.inventory_id_seq', 11, true);


--
-- Name: invoice_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.invoice_items_id_seq', 26, true);


--
-- Name: invoices_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.invoices_id_seq', 13, true);


--
-- Name: messages_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.messages_id_seq', 1, false);


--
-- Name: njmvc_categories_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.njmvc_categories_id_seq', 20, true);


--
-- Name: njmvc_inspection_results_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.njmvc_inspection_results_id_seq', 282, true);


--
-- Name: njmvc_inspections_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.njmvc_inspections_id_seq', 2, true);


--
-- Name: njmvc_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.njmvc_items_id_seq', 94, true);


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.password_reset_tokens_id_seq', 3, true);


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.payments_id_seq', 23, true);


--
-- Name: processor_webhook_receipts_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.processor_webhook_receipts_id_seq', 1, false);


--
-- Name: purchase_line_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.purchase_line_items_id_seq', 1, true);


--
-- Name: purchases_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.purchases_id_seq', 1, true);


--
-- Name: reminders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.reminders_id_seq', 5, true);


--
-- Name: repair_order_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.repair_order_events_id_seq', 268, true);


--
-- Name: repair_order_work_items_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.repair_order_work_items_id_seq', 29, true);


--
-- Name: repair_orders_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.repair_orders_id_seq', 39, true);


--
-- Name: role_permissions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.role_permissions_id_seq', 261, true);


--
-- Name: shop_settings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.shop_settings_id_seq', 1, true);


--
-- Name: square_mappings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.square_mappings_id_seq', 1, false);


--
-- Name: square_sync_states_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.square_sync_states_id_seq', 1, false);


--
-- Name: square_webhook_events_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.square_webhook_events_id_seq', 1, false);


--
-- Name: stock_movements_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.stock_movements_id_seq', 2, true);


--
-- Name: suppliers_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.suppliers_id_seq', 3, true);


--
-- Name: time_entries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.time_entries_id_seq', 1, false);


--
-- Name: used_cars_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.used_cars_id_seq', 1, true);


--
-- Name: user_board_preferences_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.user_board_preferences_id_seq', 1, false);


--
-- Name: vehicles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: neondb_owner
--

SELECT pg_catalog.setval('public.vehicles_id_seq', 18, true);


--
-- Name: activity_events activity_events_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.activity_events
    ADD CONSTRAINT activity_events_pkey PRIMARY KEY (id);


--
-- Name: appointments appointments_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);


--
-- Name: canned_jobs canned_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.canned_jobs
    ADD CONSTRAINT canned_jobs_pkey PRIMARY KEY (id);


--
-- Name: customer_categories customer_categories_name_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.customer_categories
    ADD CONSTRAINT customer_categories_name_unique UNIQUE (name);


--
-- Name: customer_categories customer_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.customer_categories
    ADD CONSTRAINT customer_categories_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: email_templates email_templates_key_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_key_unique UNIQUE (key);


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: employees employees_username_unique; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_username_unique UNIQUE (username);


--
-- Name: estimate_approval_items estimate_approval_items_approval_id_estimate_item_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approval_items
    ADD CONSTRAINT estimate_approval_items_approval_id_estimate_item_id_key UNIQUE (approval_id, estimate_item_id);


--
-- Name: estimate_approval_items estimate_approval_items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approval_items
    ADD CONSTRAINT estimate_approval_items_pkey PRIMARY KEY (id);


--
-- Name: estimate_approvals estimate_approvals_estimate_revision_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approvals
    ADD CONSTRAINT estimate_approvals_estimate_revision_id_key UNIQUE (estimate_revision_id);


--
-- Name: estimate_approvals estimate_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approvals
    ADD CONSTRAINT estimate_approvals_pkey PRIMARY KEY (id);


--
-- Name: estimate_items estimate_items_estimate_revision_id_position_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_items
    ADD CONSTRAINT estimate_items_estimate_revision_id_position_key UNIQUE (estimate_revision_id, "position");


--
-- Name: estimate_items estimate_items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_items
    ADD CONSTRAINT estimate_items_pkey PRIMARY KEY (id);


--
-- Name: estimate_revisions estimate_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_revisions
    ADD CONSTRAINT estimate_revisions_pkey PRIMARY KEY (id);


--
-- Name: estimate_revisions estimate_revisions_public_token_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_revisions
    ADD CONSTRAINT estimate_revisions_public_token_key UNIQUE (public_token);


--
-- Name: estimate_revisions estimate_revisions_repair_order_id_revision_no_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_revisions
    ADD CONSTRAINT estimate_revisions_repair_order_id_revision_no_key UNIQUE (repair_order_id, revision_no);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: idempotency_keys idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_pkey PRIMARY KEY (id);


--
-- Name: idempotency_keys idempotency_keys_scope_key_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.idempotency_keys
    ADD CONSTRAINT idempotency_keys_scope_key_key UNIQUE (scope, key);


--
-- Name: inspections inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_pkey PRIMARY KEY (id);


--
-- Name: inventory inventory_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);


--
-- Name: invoice_items invoice_items_invoice_id_position_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_position_key UNIQUE (invoice_id, "position");


--
-- Name: invoice_items invoice_items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);


--
-- Name: invoice_items invoice_items_source_work_item_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_source_work_item_id_key UNIQUE (source_work_item_id);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_public_token_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_public_token_key UNIQUE (public_token);


--
-- Name: invoices invoices_repair_order_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_repair_order_id_key UNIQUE (repair_order_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: njmvc_categories njmvc_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_categories
    ADD CONSTRAINT njmvc_categories_pkey PRIMARY KEY (id);


--
-- Name: njmvc_inspection_results njmvc_inspection_results_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_inspection_results
    ADD CONSTRAINT njmvc_inspection_results_pkey PRIMARY KEY (id);


--
-- Name: njmvc_inspections njmvc_inspections_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_inspections
    ADD CONSTRAINT njmvc_inspections_pkey PRIMARY KEY (id);


--
-- Name: njmvc_items njmvc_items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_items
    ADD CONSTRAINT njmvc_items_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: password_reset_tokens password_reset_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: payments payments_invoice_id_attempt_key_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_attempt_key_key UNIQUE (invoice_id, attempt_key);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: processor_webhook_receipts processor_webhook_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.processor_webhook_receipts
    ADD CONSTRAINT processor_webhook_receipts_pkey PRIMARY KEY (id);


--
-- Name: processor_webhook_receipts processor_webhook_receipts_processor_event_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.processor_webhook_receipts
    ADD CONSTRAINT processor_webhook_receipts_processor_event_id_key UNIQUE (processor, event_id);


--
-- Name: purchase_line_items purchase_line_items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchase_line_items
    ADD CONSTRAINT purchase_line_items_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: reminders reminders_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_pkey PRIMARY KEY (id);


--
-- Name: repair_order_events repair_order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_events
    ADD CONSTRAINT repair_order_events_pkey PRIMARY KEY (id);


--
-- Name: repair_order_work_items repair_order_work_items_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_work_items
    ADD CONSTRAINT repair_order_work_items_pkey PRIMARY KEY (id);


--
-- Name: repair_order_work_items repair_order_work_items_repair_order_id_position_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_work_items
    ADD CONSTRAINT repair_order_work_items_repair_order_id_position_key UNIQUE (repair_order_id, "position");


--
-- Name: repair_order_work_items repair_order_work_items_source_estimate_item_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_work_items
    ADD CONSTRAINT repair_order_work_items_source_estimate_item_id_key UNIQUE (source_estimate_item_id);


--
-- Name: repair_orders repair_orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders
    ADD CONSTRAINT repair_orders_order_number_key UNIQUE (order_number);


--
-- Name: repair_orders repair_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders
    ADD CONSTRAINT repair_orders_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: shop_settings shop_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.shop_settings
    ADD CONSTRAINT shop_settings_pkey PRIMARY KEY (id);


--
-- Name: square_mappings square_mappings_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_mappings
    ADD CONSTRAINT square_mappings_pkey PRIMARY KEY (id);


--
-- Name: square_sync_states square_sync_states_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_sync_states
    ADD CONSTRAINT square_sync_states_pkey PRIMARY KEY (id);


--
-- Name: square_sync_states square_sync_states_resource_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_sync_states
    ADD CONSTRAINT square_sync_states_resource_key UNIQUE (resource);


--
-- Name: square_webhook_events square_webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_webhook_events
    ADD CONSTRAINT square_webhook_events_pkey PRIMARY KEY (id);


--
-- Name: square_webhook_events square_webhook_events_square_event_id_key; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.square_webhook_events
    ADD CONSTRAINT square_webhook_events_square_event_id_key UNIQUE (square_event_id);


--
-- Name: stock_movements stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: time_entries time_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_pkey PRIMARY KEY (id);


--
-- Name: used_cars used_cars_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.used_cars
    ADD CONSTRAINT used_cars_pkey PRIMARY KEY (id);


--
-- Name: user_board_preferences user_board_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.user_board_preferences
    ADD CONSTRAINT user_board_preferences_pkey PRIMARY KEY (id);


--
-- Name: vehicles vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_pkey PRIMARY KEY (id);


--
-- Name: activity_events_entity_cursor_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX activity_events_entity_cursor_idx ON public.activity_events USING btree (entity_type, entity_id, id);


--
-- Name: activity_events_entity_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX activity_events_entity_idx ON public.activity_events USING btree (entity_type, entity_id, created_at DESC);


--
-- Name: attachments_owner_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX attachments_owner_idx ON public.attachments USING btree (owner_type, owner_id);


--
-- Name: customers_square_customer_id_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX customers_square_customer_id_unique ON public.customers USING btree (square_customer_id) WHERE (square_customer_id IS NOT NULL);


--
-- Name: estimate_approval_items_item_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX estimate_approval_items_item_idx ON public.estimate_approval_items USING btree (estimate_item_id);


--
-- Name: estimate_revisions_one_sent_active; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX estimate_revisions_one_sent_active ON public.estimate_revisions USING btree (repair_order_id) WHERE (status = 'sent'::public.estimate_revision_status);


--
-- Name: estimate_revisions_public_token_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX estimate_revisions_public_token_idx ON public.estimate_revisions USING btree (public_token);


--
-- Name: estimate_revisions_ro_status_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX estimate_revisions_ro_status_idx ON public.estimate_revisions USING btree (repair_order_id, status);


--
-- Name: inspections_public_token_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX inspections_public_token_idx ON public.inspections USING btree (public_token);


--
-- Name: inventory_preferred_supplier_id_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX inventory_preferred_supplier_id_idx ON public.inventory USING btree (preferred_supplier_id);


--
-- Name: inventory_square_catalog_object_id_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX inventory_square_catalog_object_id_unique ON public.inventory USING btree (square_catalog_object_id) WHERE (square_catalog_object_id IS NOT NULL);


--
-- Name: messages_customer_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX messages_customer_idx ON public.messages USING btree (customer_id, created_at);


--
-- Name: messages_inbound_unread_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX messages_inbound_unread_idx ON public.messages USING btree (direction, read_at);


--
-- Name: messages_twilio_sid_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX messages_twilio_sid_idx ON public.messages USING btree (twilio_sid);


--
-- Name: password_reset_tokens_employee_unused_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX password_reset_tokens_employee_unused_idx ON public.password_reset_tokens USING btree (employee_id, used_at);


--
-- Name: password_reset_tokens_expires_at_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX password_reset_tokens_expires_at_idx ON public.password_reset_tokens USING btree (expires_at);


--
-- Name: payments_invoice_status_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX payments_invoice_status_idx ON public.payments USING btree (invoice_id, status);


--
-- Name: payments_parent_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX payments_parent_idx ON public.payments USING btree (parent_payment_id);


--
-- Name: payments_processor_event_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX payments_processor_event_unique ON public.payments USING btree (processor, processor_event_id) WHERE (processor_event_id IS NOT NULL);


--
-- Name: payments_processor_payment_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX payments_processor_payment_unique ON public.payments USING btree (processor, processor_payment_id) WHERE (processor_payment_id IS NOT NULL);


--
-- Name: processor_webhook_receipts_pending_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX processor_webhook_receipts_pending_idx ON public.processor_webhook_receipts USING btree (processor, processed_at);


--
-- Name: purchases_supplier_id_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX purchases_supplier_id_idx ON public.purchases USING btree (supplier_id);


--
-- Name: repair_order_events_ro_occurred_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX repair_order_events_ro_occurred_idx ON public.repair_order_events USING btree (repair_order_id, occurred_at);


--
-- Name: repair_order_work_items_ro_status_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX repair_order_work_items_ro_status_idx ON public.repair_order_work_items USING btree (repair_order_id, status);


--
-- Name: repair_orders_customer_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX repair_orders_customer_idx ON public.repair_orders USING btree (customer_id);


--
-- Name: repair_orders_status_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX repair_orders_status_idx ON public.repair_orders USING btree (status);


--
-- Name: repair_orders_vehicle_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX repair_orders_vehicle_idx ON public.repair_orders USING btree (vehicle_id);


--
-- Name: role_permissions_role_resource_action_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX role_permissions_role_resource_action_idx ON public.role_permissions USING btree (role, resource, action);


--
-- Name: square_mappings_entity_local_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX square_mappings_entity_local_unique ON public.square_mappings USING btree (entity_type, local_id);


--
-- Name: square_mappings_square_id_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX square_mappings_square_id_unique ON public.square_mappings USING btree (square_id);


--
-- Name: stock_movements_inventory_id_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX stock_movements_inventory_id_idx ON public.stock_movements USING btree (inventory_id);


--
-- Name: stock_movements_reference_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX stock_movements_reference_idx ON public.stock_movements USING btree (reference_table, reference_id);


--
-- Name: stock_movements_source_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE INDEX stock_movements_source_idx ON public.stock_movements USING btree (inventory_id, reference_table, reference_id, reference_line_id, reason);


--
-- Name: stock_movements_work_item_consumption_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX stock_movements_work_item_consumption_unique ON public.stock_movements USING btree (work_item_id) WHERE ((reason = 'ro_consumed'::text) AND (work_item_id IS NOT NULL));


--
-- Name: suppliers_name_lower_unique; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX suppliers_name_lower_unique ON public.suppliers USING btree (lower(name));


--
-- Name: user_board_preferences_user_board_idx; Type: INDEX; Schema: public; Owner: neondb_owner
--

CREATE UNIQUE INDEX user_board_preferences_user_board_idx ON public.user_board_preferences USING btree (user_id, board_key);


--
-- Name: estimate_approval_items estimate_approval_items_immutable; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER estimate_approval_items_immutable BEFORE DELETE OR UPDATE ON public.estimate_approval_items FOR EACH ROW EXECUTE FUNCTION public.reject_repair_domain_mutation();


--
-- Name: estimate_approvals estimate_approvals_immutable; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER estimate_approvals_immutable BEFORE DELETE OR UPDATE ON public.estimate_approvals FOR EACH ROW EXECUTE FUNCTION public.reject_repair_domain_mutation();


--
-- Name: estimate_items estimate_items_sent_immutable; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER estimate_items_sent_immutable BEFORE DELETE OR UPDATE ON public.estimate_items FOR EACH ROW EXECUTE FUNCTION public.reject_sent_estimate_item_mutation();


--
-- Name: estimate_revisions estimate_revisions_transition_guard; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER estimate_revisions_transition_guard BEFORE DELETE OR UPDATE ON public.estimate_revisions FOR EACH ROW EXECUTE FUNCTION public.enforce_estimate_revision_transition();


--
-- Name: invoice_items invoice_items_immutable; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER invoice_items_immutable BEFORE DELETE OR UPDATE ON public.invoice_items FOR EACH ROW EXECUTE FUNCTION public.reject_repair_domain_mutation();


--
-- Name: invoices invoices_transition_guard; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER invoices_transition_guard BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_transition();


--
-- Name: payments payments_transition_guard; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER payments_transition_guard BEFORE DELETE OR UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_transition();


--
-- Name: repair_order_events repair_order_events_append_only; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER repair_order_events_append_only BEFORE DELETE OR UPDATE ON public.repair_order_events FOR EACH ROW EXECUTE FUNCTION public.reject_repair_domain_mutation();


--
-- Name: repair_orders repair_orders_transition_guard; Type: TRIGGER; Schema: public; Owner: neondb_owner
--

CREATE TRIGGER repair_orders_transition_guard BEFORE UPDATE ON public.repair_orders FOR EACH ROW EXECUTE FUNCTION public.enforce_repair_order_transition();


--
-- Name: activity_events activity_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.activity_events
    ADD CONSTRAINT activity_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: appointments appointments_assigned_to_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_assigned_to_id_employees_id_fk FOREIGN KEY (assigned_to_id) REFERENCES public.employees(id);


--
-- Name: appointments appointments_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: appointments appointments_vehicle_id_vehicles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.appointments
    ADD CONSTRAINT appointments_vehicle_id_vehicles_id_fk FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: attachments attachments_uploaded_by_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.attachments
    ADD CONSTRAINT attachments_uploaded_by_id_employees_id_fk FOREIGN KEY (uploaded_by_id) REFERENCES public.employees(id);


--
-- Name: customers customers_category_id_customer_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_category_id_customer_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.customer_categories(id);


--
-- Name: estimate_approval_items estimate_approval_items_approval_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approval_items
    ADD CONSTRAINT estimate_approval_items_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES public.estimate_approvals(id) ON DELETE RESTRICT;


--
-- Name: estimate_approval_items estimate_approval_items_estimate_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approval_items
    ADD CONSTRAINT estimate_approval_items_estimate_item_id_fkey FOREIGN KEY (estimate_item_id) REFERENCES public.estimate_items(id) ON DELETE RESTRICT;


--
-- Name: estimate_approvals estimate_approvals_estimate_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_approvals
    ADD CONSTRAINT estimate_approvals_estimate_revision_id_fkey FOREIGN KEY (estimate_revision_id) REFERENCES public.estimate_revisions(id) ON DELETE RESTRICT;


--
-- Name: estimate_items estimate_items_estimate_revision_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_items
    ADD CONSTRAINT estimate_items_estimate_revision_id_fkey FOREIGN KEY (estimate_revision_id) REFERENCES public.estimate_revisions(id) ON DELETE CASCADE;


--
-- Name: estimate_items estimate_items_inventory_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_items
    ADD CONSTRAINT estimate_items_inventory_item_id_fkey FOREIGN KEY (inventory_item_id) REFERENCES public.inventory(id) ON DELETE SET NULL;


--
-- Name: estimate_revisions estimate_revisions_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_revisions
    ADD CONSTRAINT estimate_revisions_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.employees(id);


--
-- Name: estimate_revisions estimate_revisions_repair_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.estimate_revisions
    ADD CONSTRAINT estimate_revisions_repair_order_id_fkey FOREIGN KEY (repair_order_id) REFERENCES public.repair_orders(id) ON DELETE CASCADE;


--
-- Name: inspections inspections_inspected_by_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_inspected_by_id_employees_id_fk FOREIGN KEY (inspected_by_id) REFERENCES public.employees(id);


--
-- Name: inspections inspections_repair_order_id_repair_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_repair_order_id_repair_orders_id_fk FOREIGN KEY (repair_order_id) REFERENCES public.repair_orders(id);


--
-- Name: inspections inspections_vehicle_id_vehicles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inspections
    ADD CONSTRAINT inspections_vehicle_id_vehicles_id_fk FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: inventory inventory_preferred_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_preferred_supplier_id_fkey FOREIGN KEY (preferred_supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: invoice_items invoice_items_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;


--
-- Name: invoice_items invoice_items_source_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoice_items
    ADD CONSTRAINT invoice_items_source_work_item_id_fkey FOREIGN KEY (source_work_item_id) REFERENCES public.repair_order_work_items(id) ON DELETE RESTRICT;


--
-- Name: invoices invoices_issued_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_issued_by_id_fkey FOREIGN KEY (issued_by_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: invoices invoices_repair_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_repair_order_id_fkey FOREIGN KEY (repair_order_id) REFERENCES public.repair_orders(id) ON DELETE RESTRICT;


--
-- Name: invoices invoices_voided_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_voided_by_id_fkey FOREIGN KEY (voided_by_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: messages messages_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: messages messages_estimate_id_estimate_revisions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_estimate_id_estimate_revisions_id_fk FOREIGN KEY (estimate_id) REFERENCES public.estimate_revisions(id) ON DELETE SET NULL;


--
-- Name: messages messages_invoice_id_invoices_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_invoice_id_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;


--
-- Name: messages messages_repair_order_id_repair_orders_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_repair_order_id_repair_orders_id_fk FOREIGN KEY (repair_order_id) REFERENCES public.repair_orders(id) ON DELETE SET NULL;


--
-- Name: njmvc_inspection_results njmvc_inspection_results_inspection_id_njmvc_inspections_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_inspection_results
    ADD CONSTRAINT njmvc_inspection_results_inspection_id_njmvc_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES public.njmvc_inspections(id) ON DELETE CASCADE;


--
-- Name: njmvc_inspection_results njmvc_inspection_results_item_id_njmvc_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_inspection_results
    ADD CONSTRAINT njmvc_inspection_results_item_id_njmvc_items_id_fk FOREIGN KEY (item_id) REFERENCES public.njmvc_items(id) ON DELETE RESTRICT;


--
-- Name: njmvc_inspections njmvc_inspections_vehicle_id_vehicles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_inspections
    ADD CONSTRAINT njmvc_inspections_vehicle_id_vehicles_id_fk FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: njmvc_items njmvc_items_category_id_njmvc_categories_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.njmvc_items
    ADD CONSTRAINT njmvc_items_category_id_njmvc_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.njmvc_categories(id) ON DELETE CASCADE;


--
-- Name: password_reset_tokens password_reset_tokens_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.password_reset_tokens
    ADD CONSTRAINT password_reset_tokens_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: payments payments_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE RESTRICT;


--
-- Name: payments payments_parent_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_parent_payment_id_fkey FOREIGN KEY (parent_payment_id) REFERENCES public.payments(id) ON DELETE RESTRICT;


--
-- Name: purchase_line_items purchase_line_items_inventory_id_inventory_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchase_line_items
    ADD CONSTRAINT purchase_line_items_inventory_id_inventory_id_fk FOREIGN KEY (inventory_id) REFERENCES public.inventory(id);


--
-- Name: purchase_line_items purchase_line_items_purchase_id_purchases_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchase_line_items
    ADD CONSTRAINT purchase_line_items_purchase_id_purchases_id_fk FOREIGN KEY (purchase_id) REFERENCES public.purchases(id) ON DELETE CASCADE;


--
-- Name: purchase_line_items purchase_line_items_used_car_id_used_cars_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchase_line_items
    ADD CONSTRAINT purchase_line_items_used_car_id_used_cars_id_fk FOREIGN KEY (used_car_id) REFERENCES public.used_cars(id);


--
-- Name: purchases purchases_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.purchases
    ADD CONSTRAINT purchases_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;


--
-- Name: reminders reminders_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: reminders reminders_vehicle_id_vehicles_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.reminders
    ADD CONSTRAINT reminders_vehicle_id_vehicles_id_fk FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: repair_order_events repair_order_events_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_events
    ADD CONSTRAINT repair_order_events_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: repair_order_events repair_order_events_repair_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_events
    ADD CONSTRAINT repair_order_events_repair_order_id_fkey FOREIGN KEY (repair_order_id) REFERENCES public.repair_orders(id) ON DELETE CASCADE;


--
-- Name: repair_order_work_items repair_order_work_items_performed_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_work_items
    ADD CONSTRAINT repair_order_work_items_performed_by_id_fkey FOREIGN KEY (performed_by_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: repair_order_work_items repair_order_work_items_repair_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_work_items
    ADD CONSTRAINT repair_order_work_items_repair_order_id_fkey FOREIGN KEY (repair_order_id) REFERENCES public.repair_orders(id) ON DELETE CASCADE;


--
-- Name: repair_order_work_items repair_order_work_items_source_estimate_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_order_work_items
    ADD CONSTRAINT repair_order_work_items_source_estimate_item_id_fkey FOREIGN KEY (source_estimate_item_id) REFERENCES public.estimate_items(id) ON DELETE RESTRICT;


--
-- Name: repair_orders repair_orders_assigned_to_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders
    ADD CONSTRAINT repair_orders_assigned_to_id_fkey FOREIGN KEY (assigned_to_id) REFERENCES public.employees(id) ON DELETE SET NULL;


--
-- Name: repair_orders repair_orders_created_by_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders
    ADD CONSTRAINT repair_orders_created_by_id_fkey FOREIGN KEY (created_by_id) REFERENCES public.employees(id);


--
-- Name: repair_orders repair_orders_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders
    ADD CONSTRAINT repair_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: repair_orders repair_orders_used_car_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders
    ADD CONSTRAINT repair_orders_used_car_id_fkey FOREIGN KEY (used_car_id) REFERENCES public.used_cars(id) ON DELETE SET NULL;


--
-- Name: repair_orders repair_orders_vehicle_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.repair_orders
    ADD CONSTRAINT repair_orders_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id);


--
-- Name: stock_movements stock_movements_inventory_id_inventory_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_inventory_id_inventory_id_fk FOREIGN KEY (inventory_id) REFERENCES public.inventory(id) ON DELETE CASCADE;


--
-- Name: stock_movements stock_movements_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.stock_movements
    ADD CONSTRAINT stock_movements_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.repair_order_work_items(id);


--
-- Name: time_entries time_entries_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id);


--
-- Name: time_entries time_entries_repair_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_repair_order_id_fkey FOREIGN KEY (repair_order_id) REFERENCES public.repair_orders(id);


--
-- Name: time_entries time_entries_work_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_work_item_id_fkey FOREIGN KEY (work_item_id) REFERENCES public.repair_order_work_items(id);


--
-- Name: used_cars used_cars_buyer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.used_cars
    ADD CONSTRAINT used_cars_buyer_id_fkey FOREIGN KEY (buyer_id) REFERENCES public.customers(id);


--
-- Name: used_cars used_cars_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.used_cars
    ADD CONSTRAINT used_cars_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: user_board_preferences user_board_preferences_user_id_employees_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.user_board_preferences
    ADD CONSTRAINT user_board_preferences_user_id_employees_id_fk FOREIGN KEY (user_id) REFERENCES public.employees(id) ON DELETE CASCADE;


--
-- Name: vehicles vehicles_customer_id_customers_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: neondb_owner
--

ALTER TABLE ONLY public.vehicles
    ADD CONSTRAINT vehicles_customer_id_customers_id_fk FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO neon_superuser WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: cloud_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE cloud_admin IN SCHEMA public GRANT ALL ON TABLES TO neon_superuser WITH GRANT OPTION;


--
-- PostgreSQL database dump complete
--

\unrestrict hxRlSU8roGhc2bS98Dj5HP5HjP67RLqxet0B5MrHPtKWKLXFJyGynrdZP3QGH4P

