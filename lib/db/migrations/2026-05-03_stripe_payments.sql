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

-- Drizzle schema declares publicToken as .unique(), which it expects as a
-- table CONSTRAINT (not just an index). Pre-create the constraint so the
-- subsequent drizzle-kit push has nothing to prompt about. Dedup any
-- accidental duplicates first (NULLs are fine — distinct in postgres).
DELETE FROM invoices a
USING invoices b
WHERE a.id > b.id AND a.public_token IS NOT NULL AND a.public_token = b.public_token;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_public_token_unique'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_public_token_unique UNIQUE (public_token);
  END IF;
END $$;

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

-- Schema declares stripeEventId as .unique(); pre-create as a constraint
-- so drizzle-kit push doesn't prompt.
DELETE FROM payments a
USING payments b
WHERE a.id > b.id AND a.stripe_event_id IS NOT NULL AND a.stripe_event_id = b.stripe_event_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_stripe_event_id_unique'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_stripe_event_id_unique UNIQUE (stripe_event_id);
  END IF;
END $$;

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
