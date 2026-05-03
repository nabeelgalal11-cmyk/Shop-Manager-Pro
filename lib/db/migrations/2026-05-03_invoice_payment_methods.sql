-- Task #25: broaden invoice checkout payment methods.
-- Adds a per-shop toggle for ACH (us_bank_account). Apple Pay/Google Pay/Link
-- are surfaced automatically by Stripe Checkout when card is enabled and the
-- shop has them activated in the Stripe dashboard, so no DB toggle is needed
-- for those. ACH is opt-in because it has multi-day settlement.

BEGIN;

ALTER TABLE shop_settings
  ADD COLUMN IF NOT EXISTS stripe_ach_enabled boolean NOT NULL DEFAULT false;

COMMIT;
