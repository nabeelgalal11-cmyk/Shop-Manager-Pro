-- Task #21: Stripe online payments for invoices.
-- Adds the columns the new payment flow needs across invoices, payments,
-- and shop_settings. All columns are nullable / have defaults so existing
-- rows keep working unchanged.

BEGIN;

-- Public, token-protected pay link + Stripe session/intent linkage.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS public_token text,
  ADD COLUMN IF NOT EXISTS stripe_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_public_token_key
  ON invoices (public_token);

-- Per-payment Stripe traceability + lifecycle status. Successful manual
-- entries default to 'succeeded'; Stripe failures are persisted with
-- status='failed' and amount=0 so they appear in the timeline without
-- being counted toward amount_paid.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS stripe_event_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'succeeded',
  ADD COLUMN IF NOT EXISTS failure_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_event_id_key
  ON payments (stripe_event_id);

-- Concurrency hardening: even if both checkout.session.completed and
-- payment_intent.succeeded race past the application-level dedupe check, the
-- DB rejects a second succeeded row for the same payment_intent. The webhook
-- handler catches the unique violation and returns 200 to Stripe.
CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_pi_succeeded_key
  ON payments (stripe_payment_intent_id)
  WHERE status = 'succeeded' AND stripe_payment_intent_id IS NOT NULL;

-- Stripe credentials live in shop_settings so they can be edited from the
-- admin UI without redeploying.
ALTER TABLE shop_settings
  ADD COLUMN IF NOT EXISTS stripe_publishable_key text,
  ADD COLUMN IF NOT EXISTS stripe_secret_key text,
  ADD COLUMN IF NOT EXISTS stripe_webhook_secret text;

COMMIT;
