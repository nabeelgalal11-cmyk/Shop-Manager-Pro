-- Repair-domain reset/rebuild. It intentionally preserves customers, vehicles, inventory,
-- employees, users, used_cars, attachments, inspections, messages, and Square configuration.
-- Safety valve: if any disposable repair data exists, run only after:
--   SET app.authorize_repair_domain_reset = 'true';
BEGIN;

DO $$
DECLARE has_rows boolean := false;
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['repair_orders','estimates','estimate_revisions','invoices','payments'] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I LIMIT 1)', table_name) INTO has_rows;
      EXIT WHEN has_rows;
    END IF;
  END LOOP;
  IF has_rows AND coalesce(current_setting('app.authorize_repair_domain_reset', true), '') NOT IN ('true', 'on', '1') THEN
    RAISE EXCEPTION 'repair-domain data exists; set app.authorize_repair_domain_reset=true to authorize reset';
  END IF;
END $$;

-- CASCADE only removes foreign-key constraints from retained integration/operational tables.
DROP TABLE IF EXISTS processor_webhook_receipts CASCADE;
DROP TABLE IF EXISTS idempotency_keys CASCADE;
DROP TABLE IF EXISTS repair_order_events CASCADE;
DROP TABLE IF EXISTS invoice_items CASCADE;
DROP TABLE IF EXISTS repair_order_work_items CASCADE;
DROP TABLE IF EXISTS estimate_approval_items CASCADE;
DROP TABLE IF EXISTS estimate_approvals CASCADE;
DROP TABLE IF EXISTS estimate_items CASCADE;
DROP TABLE IF EXISTS estimate_revisions CASCADE;
DROP TABLE IF EXISTS square_refunds CASCADE;
DROP TABLE IF EXISTS square_terminal_checkouts CASCADE;
DROP TABLE IF EXISTS estimate_events CASCADE;
DROP TABLE IF EXISTS line_items CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS estimates CASCADE;
DROP TABLE IF EXISTS time_entries CASCADE;
DROP TABLE IF EXISTS repair_orders CASCADE;
DROP TYPE IF EXISTS payment_status CASCADE;
DROP TYPE IF EXISTS invoice_status CASCADE;
DROP TYPE IF EXISTS estimate_approval_item_decision CASCADE;
DROP TYPE IF EXISTS estimate_item_kind CASCADE;
DROP TYPE IF EXISTS estimate_approval_decision CASCADE;
DROP TYPE IF EXISTS estimate_revision_status CASCADE;
DROP TYPE IF EXISTS estimate_revision_kind CASCADE;
DROP TYPE IF EXISTS repair_order_work_item_status CASCADE;
DROP TYPE IF EXISTS repair_order_event_type CASCADE;
DROP TYPE IF EXISTS repair_order_priority CASCADE;
DROP TYPE IF EXISTS repair_order_status CASCADE;

CREATE TYPE repair_order_status AS ENUM ('open','diagnosing','awaiting_approval','authorized','in_progress','completed','cancelled');
CREATE TYPE repair_order_priority AS ENUM ('low','normal','high','urgent');
CREATE TYPE estimate_revision_kind AS ENUM ('estimate','supplement');
CREATE TYPE estimate_revision_status AS ENUM ('draft','sent','approved','partially_approved','declined','superseded');
CREATE TYPE estimate_item_kind AS ENUM ('part','labor','fee','discount');
CREATE TYPE estimate_approval_item_decision AS ENUM ('approved','declined');
CREATE TYPE estimate_approval_decision AS ENUM ('approved','partially_approved','declined');
CREATE TYPE repair_order_work_item_status AS ENUM ('authorized','performed','void');
CREATE TYPE invoice_status AS ENUM ('draft','issued','partially_paid','paid','void');
CREATE TYPE payment_status AS ENUM ('pending','succeeded','failed','refunded','void');
CREATE TYPE repair_order_event_type AS ENUM ('opened','status_changed','assigned','estimate_created','estimate_sent','estimate_decided','supplement_created','supplement_sent','supplement_decided','work_authorized','work_performed','invoice_created','invoice_issued','invoice_voided','payment_recorded','payment_failed','payment_refunded','payment_voided','ro_completed','cancelled','note_added');

CREATE TABLE repair_orders (
  id serial PRIMARY KEY, order_number text NOT NULL UNIQUE,
  customer_id integer NOT NULL REFERENCES customers(id), vehicle_id integer NOT NULL REFERENCES vehicles(id),
  used_car_id integer REFERENCES used_cars(id) ON DELETE SET NULL, internal boolean NOT NULL DEFAULT false,
  assigned_to_id integer REFERENCES employees(id) ON DELETE SET NULL, created_by_id integer NOT NULL REFERENCES employees(id),
  status repair_order_status NOT NULL DEFAULT 'open', priority repair_order_priority NOT NULL DEFAULT 'normal',
  complaint text, diagnosis text, notes text, mileage_in integer, mileage_out integer,
  promised_at timestamptz, opened_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  cancelled_at timestamptz, cancellation_reason text, version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (version > 0), CHECK (mileage_out IS NULL OR mileage_in IS NULL OR mileage_out >= mileage_in),
  CHECK ((status <> 'completed' OR completed_at IS NOT NULL) AND (status <> 'cancelled' OR (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL)))
);
CREATE INDEX repair_orders_customer_idx ON repair_orders(customer_id);
CREATE INDEX repair_orders_vehicle_idx ON repair_orders(vehicle_id);
CREATE INDEX repair_orders_status_idx ON repair_orders(status);

CREATE TABLE estimate_revisions (
  id serial PRIMARY KEY, repair_order_id integer NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  revision_no integer NOT NULL, kind estimate_revision_kind NOT NULL DEFAULT 'estimate',
  status estimate_revision_status NOT NULL DEFAULT 'draft', notes text,
  customer_snapshot jsonb NOT NULL, vehicle_snapshot jsonb NOT NULL,
  subtotal numeric(14,2) NOT NULL DEFAULT 0, tax_rate_bps integer NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0, public_token text UNIQUE, sent_at timestamptz,
  created_by_id integer NOT NULL REFERENCES employees(id), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(repair_order_id, revision_no),
  CHECK (revision_no > 0), CHECK (subtotal >= 0 AND tax_amount >= 0 AND total >= 0 AND tax_rate_bps BETWEEN 0 AND 10000)
);
CREATE INDEX estimate_revisions_ro_status_idx ON estimate_revisions(repair_order_id,status);
CREATE INDEX estimate_revisions_public_token_idx ON estimate_revisions(public_token);
CREATE UNIQUE INDEX estimate_revisions_one_sent_active ON estimate_revisions(repair_order_id) WHERE status = 'sent';
CREATE TABLE estimate_items (
  id serial PRIMARY KEY, estimate_revision_id integer NOT NULL REFERENCES estimate_revisions(id) ON DELETE CASCADE,
  position integer NOT NULL, kind estimate_item_kind NOT NULL, description text NOT NULL,
  quantity numeric(14,3) NOT NULL DEFAULT 1, unit_price numeric(14,2) NOT NULL DEFAULT 0,
  unit_cost numeric(14,2), inventory_item_id integer REFERENCES inventory(id) ON DELETE SET NULL,
  estimated_hours numeric(10,2),
  warranty_months integer, warranty_miles integer, UNIQUE(estimate_revision_id,position),
  CHECK(position > 0), CHECK(quantity > 0), CHECK(unit_price >= 0 AND (unit_cost IS NULL OR unit_cost >= 0) AND (estimated_hours IS NULL OR estimated_hours >= 0)),
  CHECK((warranty_months IS NULL OR warranty_months >= 0) AND (warranty_miles IS NULL OR warranty_miles >= 0))
);
CREATE TABLE estimate_approvals (
  id serial PRIMARY KEY, estimate_revision_id integer NOT NULL UNIQUE REFERENCES estimate_revisions(id) ON DELETE RESTRICT,
  decision estimate_approval_decision NOT NULL, signer_name text, signer_email text, signature_url text,
  document_hash text NOT NULL, request_ip text, request_user_agent text, decided_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE estimate_approval_items (
  id serial PRIMARY KEY, approval_id integer NOT NULL REFERENCES estimate_approvals(id) ON DELETE RESTRICT,
  estimate_item_id integer NOT NULL REFERENCES estimate_items(id) ON DELETE RESTRICT,
  decision estimate_approval_item_decision NOT NULL, UNIQUE(approval_id,estimate_item_id)
);
CREATE INDEX estimate_approval_items_item_idx ON estimate_approval_items(estimate_item_id);
CREATE TABLE repair_order_work_items (
  id serial PRIMARY KEY, repair_order_id integer NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  source_estimate_item_id integer NOT NULL UNIQUE REFERENCES estimate_items(id) ON DELETE RESTRICT,
  position integer NOT NULL, kind estimate_item_kind NOT NULL, description text NOT NULL, quantity numeric(14,3) NOT NULL,
  unit_price numeric(14,2) NOT NULL, unit_cost numeric(14,2), estimated_hours numeric(10,2),
  status repair_order_work_item_status NOT NULL DEFAULT 'authorized', authorized_at timestamptz NOT NULL DEFAULT now(),
  performed_at timestamptz, performed_by_id integer REFERENCES employees(id) ON DELETE SET NULL,
  voided_at timestamptz, void_reason text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(repair_order_id,position), CHECK(position > 0), CHECK(quantity > 0 AND unit_price >= 0 AND (unit_cost IS NULL OR unit_cost >= 0) AND (estimated_hours IS NULL OR estimated_hours >= 0))
);
CREATE INDEX repair_order_work_items_ro_status_idx ON repair_order_work_items(repair_order_id,status);
CREATE TABLE invoices (
  id serial PRIMARY KEY, invoice_number text NOT NULL UNIQUE,
  repair_order_id integer NOT NULL UNIQUE REFERENCES repair_orders(id) ON DELETE RESTRICT,
  customer_snapshot jsonb NOT NULL, vehicle_snapshot jsonb NOT NULL, status invoice_status NOT NULL DEFAULT 'draft',
  notes text, subtotal numeric(14,2) NOT NULL DEFAULT 0, tax_rate_bps integer NOT NULL DEFAULT 0,
  tax_amount numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0, amount_paid numeric(14,2) NOT NULL DEFAULT 0,
  balance numeric(14,2) NOT NULL DEFAULT 0, tax_exempt boolean NOT NULL DEFAULT false, tax_exempt_number text,
  public_token text UNIQUE, issued_at timestamptz, issued_by_id integer REFERENCES employees(id) ON DELETE SET NULL,
  voided_at timestamptz, voided_by_id integer REFERENCES employees(id) ON DELETE SET NULL, void_reason text,
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(version > 0), CHECK(subtotal >= 0 AND tax_amount >= 0 AND total >= 0 AND amount_paid >= 0 AND balance >= 0 AND tax_rate_bps BETWEEN 0 AND 10000),
  CHECK(status <> 'void' OR (voided_at IS NOT NULL AND void_reason IS NOT NULL))
);
CREATE TABLE invoice_items (
  id serial PRIMARY KEY, invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  source_work_item_id integer NOT NULL UNIQUE REFERENCES repair_order_work_items(id) ON DELETE RESTRICT,
  position integer NOT NULL, kind estimate_item_kind NOT NULL, description text NOT NULL, quantity numeric(14,3) NOT NULL,
  unit_price numeric(14,2) NOT NULL, unit_cost numeric(14,2), line_total numeric(14,2) NOT NULL,
  UNIQUE(invoice_id,position), CHECK(position > 0), CHECK(quantity > 0 AND unit_price >= 0 AND (unit_cost IS NULL OR unit_cost >= 0))
);
CREATE TABLE payments (
  id serial PRIMARY KEY, invoice_id integer NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  amount numeric(14,2) NOT NULL CHECK(amount > 0), status payment_status NOT NULL DEFAULT 'pending',
  method text NOT NULL, processor text, processor_payment_id text, processor_event_id text,
  attempt_key text NOT NULL, idempotency_key text, parent_payment_id integer REFERENCES payments(id) ON DELETE RESTRICT,
  reference_number text, failure_reason text, refunded_at timestamptz, voided_at timestamptz,
  processed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(invoice_id,attempt_key),
  CHECK ((status = 'refunded' AND parent_payment_id IS NOT NULL) OR parent_payment_id IS NULL OR status = 'void')
);
CREATE UNIQUE INDEX payments_processor_payment_unique ON payments(processor,processor_payment_id) WHERE processor_payment_id IS NOT NULL;
CREATE UNIQUE INDEX payments_processor_event_unique ON payments(processor,processor_event_id) WHERE processor_event_id IS NOT NULL;
CREATE INDEX payments_invoice_status_idx ON payments(invoice_id,status);
CREATE INDEX payments_parent_idx ON payments(parent_payment_id);
CREATE TABLE time_entries (
  id serial PRIMARY KEY, employee_id integer NOT NULL REFERENCES employees(id),
  repair_order_id integer REFERENCES repair_orders(id), work_item_id integer REFERENCES repair_order_work_items(id),
  clock_in timestamptz NOT NULL, clock_out timestamptz, total_hours numeric(10,2), notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE repair_order_events (
  id serial PRIMARY KEY, repair_order_id integer NOT NULL REFERENCES repair_orders(id) ON DELETE CASCADE,
  event_type repair_order_event_type NOT NULL, actor_id integer REFERENCES employees(id) ON DELETE SET NULL,
  actor_label text, payload jsonb NOT NULL DEFAULT '{}', occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX repair_order_events_ro_occurred_idx ON repair_order_events(repair_order_id,occurred_at);
CREATE TABLE idempotency_keys (
  id serial PRIMARY KEY, scope text NOT NULL, key text NOT NULL, request_hash text NOT NULL,
  response_status integer, response_body jsonb, completed_at timestamptz, expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(scope,key)
);
CREATE TABLE processor_webhook_receipts (
  id serial PRIMARY KEY, processor text NOT NULL, event_id text NOT NULL, event_type text NOT NULL,
  payload jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, failure_reason text,
  UNIQUE(processor,event_id)
);
CREATE INDEX processor_webhook_receipts_pending_idx ON processor_webhook_receipts(processor,processed_at);

-- Retained unrelated operational tables regain valid FKs to the rebuilt aggregate.
ALTER TABLE inspections DROP CONSTRAINT IF EXISTS inspections_repair_order_id_repair_orders_id_fk;
ALTER TABLE inspections ADD CONSTRAINT inspections_repair_order_id_repair_orders_id_fk FOREIGN KEY (repair_order_id) REFERENCES repair_orders(id);
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_repair_order_id_repair_orders_id_fk;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_estimate_id_estimates_id_fk;
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_invoice_id_invoices_id_fk;
ALTER TABLE messages ADD CONSTRAINT messages_repair_order_id_repair_orders_id_fk FOREIGN KEY (repair_order_id) REFERENCES repair_orders(id) ON DELETE SET NULL;
ALTER TABLE messages ADD CONSTRAINT messages_estimate_id_estimate_revisions_id_fk FOREIGN KEY (estimate_id) REFERENCES estimate_revisions(id) ON DELETE SET NULL;
ALTER TABLE messages ADD CONSTRAINT messages_invoice_id_invoices_id_fk FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS work_item_id integer REFERENCES repair_order_work_items(id);
CREATE UNIQUE INDEX IF NOT EXISTS stock_movements_work_item_consumption_unique ON stock_movements(work_item_id) WHERE reason = 'ro_consumed' AND work_item_id IS NOT NULL;

-- Enforce immutability after customer exposure and for audit/ledger snapshots.
CREATE OR REPLACE FUNCTION reject_repair_domain_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is immutable', TG_TABLE_NAME; END $$;
CREATE TRIGGER estimate_approvals_immutable BEFORE UPDATE OR DELETE ON estimate_approvals FOR EACH ROW EXECUTE FUNCTION reject_repair_domain_mutation();
CREATE TRIGGER repair_order_events_append_only BEFORE UPDATE OR DELETE ON repair_order_events FOR EACH ROW EXECUTE FUNCTION reject_repair_domain_mutation();
CREATE TRIGGER estimate_approval_items_immutable BEFORE UPDATE OR DELETE ON estimate_approval_items FOR EACH ROW EXECUTE FUNCTION reject_repair_domain_mutation();
CREATE OR REPLACE FUNCTION enforce_estimate_revision_transition() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER estimate_revisions_transition_guard BEFORE UPDATE OR DELETE ON estimate_revisions FOR EACH ROW EXECUTE FUNCTION enforce_estimate_revision_transition();
CREATE OR REPLACE FUNCTION reject_sent_estimate_item_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM estimate_revisions WHERE id = OLD.estimate_revision_id AND sent_at IS NOT NULL) THEN
    RAISE EXCEPTION 'items on sent estimate revisions are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER estimate_items_sent_immutable BEFORE UPDATE OR DELETE ON estimate_items FOR EACH ROW EXECUTE FUNCTION reject_sent_estimate_item_mutation();
CREATE TRIGGER invoice_items_immutable BEFORE UPDATE OR DELETE ON invoice_items FOR EACH ROW EXECUTE FUNCTION reject_repair_domain_mutation();
CREATE OR REPLACE FUNCTION enforce_payment_transition() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER payments_transition_guard BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION enforce_payment_transition();

-- Aggregate lifecycle guards. These duplicate the pure domain_rules matrix at
-- the persistence boundary so ad-hoc SQL cannot bypass workflow invariants.
CREATE OR REPLACE FUNCTION enforce_repair_order_transition() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER repair_orders_transition_guard BEFORE UPDATE ON repair_orders FOR EACH ROW EXECUTE FUNCTION enforce_repair_order_transition();

CREATE OR REPLACE FUNCTION enforce_invoice_transition() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER invoices_transition_guard BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION enforce_invoice_transition();

-- Backfill legacy issued invoices once; normal application issuance always
-- creates the token in the same locked transaction.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
UPDATE invoices SET public_token = encode(gen_random_bytes(32), 'hex')
WHERE status <> 'draft' AND public_token IS NULL;
COMMIT;