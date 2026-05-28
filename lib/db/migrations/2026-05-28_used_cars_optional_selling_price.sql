-- Task #48: Used Car Recon Panel — make selling price optional, default status to needs_work.
-- Apply with: psql "$DATABASE_URL" -f lib/db/migrations/2026-05-28_used_cars_optional_selling_price.sql

BEGIN;

ALTER TABLE used_cars ALTER COLUMN selling_price DROP NOT NULL;
ALTER TABLE used_cars ALTER COLUMN status SET DEFAULT 'needs_work';

COMMIT;
