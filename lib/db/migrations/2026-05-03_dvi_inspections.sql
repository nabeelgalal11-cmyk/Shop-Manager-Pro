-- Task #28: Digital Vehicle Inspection.
-- Adds public token + e-signature columns so the customer can review the
-- inspection on their phone, approve / decline individual items, and sign.
-- Items jsonb gains a richer per-item shape (status, note, photos[],
-- customerDecision, decidedAt) — no migration needed for jsonb itself, but
-- the API layer accepts both old and new shapes.
-- Idempotent so it is safe to re-apply.

BEGIN;

ALTER TABLE inspections
  ADD COLUMN IF NOT EXISTS public_token            text,
  ADD COLUMN IF NOT EXISTS sent_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS customer_signature_url  text,
  ADD COLUMN IF NOT EXISTS customer_signed_at      timestamptz,
  ADD COLUMN IF NOT EXISTS customer_signer_name    text,
  ADD COLUMN IF NOT EXISTS customer_ip             text;

CREATE UNIQUE INDEX IF NOT EXISTS inspections_public_token_idx
  ON inspections (public_token);

COMMIT;
