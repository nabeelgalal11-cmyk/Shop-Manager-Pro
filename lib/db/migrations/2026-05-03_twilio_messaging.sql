-- Task #27: Two-way SMS via Twilio.
-- Adds Twilio creds to shop_settings, preferred-channel + opt-out fields to
-- customers, and a `messages` table for both inbound and outbound texts.
-- Idempotent so it is safe to re-apply.

BEGIN;

-- ---- shop_settings: Twilio creds ----
ALTER TABLE shop_settings
  ADD COLUMN IF NOT EXISTS twilio_account_sid text,
  ADD COLUMN IF NOT EXISTS twilio_auth_token text,
  ADD COLUMN IF NOT EXISTS twilio_from_number text;

-- ---- customers: contact preference + opt-out ----
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS preferred_channel text NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS sms_opt_out text NOT NULL DEFAULT 'false';

-- ---- messages table ----
CREATE TABLE IF NOT EXISTS messages (
  id              SERIAL PRIMARY KEY,
  customer_id     INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  repair_order_id INTEGER REFERENCES repair_orders(id) ON DELETE SET NULL,
  estimate_id     INTEGER REFERENCES estimates(id) ON DELETE SET NULL,
  invoice_id      INTEGER REFERENCES invoices(id) ON DELETE SET NULL,
  direction       TEXT NOT NULL,                       -- 'inbound' | 'outbound'
  channel         TEXT NOT NULL DEFAULT 'sms',
  from_number     TEXT,
  to_number       TEXT,
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued',      -- queued|sent|delivered|failed|received
  failure_reason  TEXT,
  twilio_sid      TEXT,
  read_at         TIMESTAMPTZ,
  sent_by_user_id INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messages_customer_idx
  ON messages (customer_id, created_at);
CREATE INDEX IF NOT EXISTS messages_twilio_sid_idx
  ON messages (twilio_sid);
CREATE INDEX IF NOT EXISTS messages_inbound_unread_idx
  ON messages (direction, read_at);

COMMIT;
