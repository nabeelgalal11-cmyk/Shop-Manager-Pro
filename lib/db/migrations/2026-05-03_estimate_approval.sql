BEGIN;

ALTER TABLE estimates ADD COLUMN IF NOT EXISTS public_token text;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS sent_at timestamp;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS customer_signature_url text;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS customer_signed_at timestamp;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS customer_signer_name text;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS customer_ip text;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS decline_reason text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estimates_public_token_unique'
  ) THEN
    ALTER TABLE estimates ADD CONSTRAINT estimates_public_token_unique UNIQUE (public_token);
  END IF;
END$$;

ALTER TABLE line_items ADD COLUMN IF NOT EXISTS customer_decision text NOT NULL DEFAULT 'pending';
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS decided_at timestamp;

COMMIT;
