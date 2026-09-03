ALTER TABLE invoices ADD COLUMN IF NOT EXISTS square_payment_id text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS square_payment_id text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS square_customer_id text;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS square_catalog_object_id text;
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS square_location_id text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_square_payment_id_unique
  ON payments (square_payment_id) WHERE square_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS customers_square_customer_id_unique
  ON customers (square_customer_id) WHERE square_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_square_catalog_object_id_unique
  ON inventory (square_catalog_object_id) WHERE square_catalog_object_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS square_mappings (
  id serial PRIMARY KEY, entity_type text NOT NULL, local_id integer NOT NULL,
  square_id text NOT NULL, square_version integer, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS square_mappings_entity_local_unique ON square_mappings (entity_type, local_id);
CREATE UNIQUE INDEX IF NOT EXISTS square_mappings_square_id_unique ON square_mappings (square_id);
CREATE TABLE IF NOT EXISTS square_webhook_events (
  id serial PRIMARY KEY, square_event_id text NOT NULL UNIQUE, event_type text NOT NULL,
  payload jsonb NOT NULL, processed_at timestamptz, failure_reason text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS square_sync_states (
  id serial PRIMARY KEY, resource text NOT NULL UNIQUE, cursor text, last_synced_at timestamptz,
  last_error text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS square_terminal_checkouts (
  id serial PRIMARY KEY, invoice_id integer NOT NULL REFERENCES invoices(id),
  square_checkout_id text NOT NULL UNIQUE, device_id text NOT NULL, status text NOT NULL,
  amount numeric(10,2) NOT NULL, square_payment_id text, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS square_refunds (
  id serial PRIMARY KEY, payment_id integer NOT NULL REFERENCES payments(id),
  square_refund_id text NOT NULL UNIQUE, amount numeric(10,2) NOT NULL, status text NOT NULL,
  reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);