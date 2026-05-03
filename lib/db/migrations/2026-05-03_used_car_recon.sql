-- Task #15: Used-car reconditioning workflow + profitability
-- Apply with: psql "$DATABASE_URL" -f lib/db/migrations/2026-05-03_used_car_recon.sql

BEGIN;

-- 1) shop_settings: holds the default labor rate used for recon labor cost when
--    a time entry has no per-employee hourly rate.
CREATE TABLE IF NOT EXISTS shop_settings (
  id SERIAL PRIMARY KEY,
  labor_rate NUMERIC(10, 2) NOT NULL DEFAULT 95,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO shop_settings (labor_rate)
SELECT 95
WHERE NOT EXISTS (SELECT 1 FROM shop_settings);

-- 2) repair_orders: support internal recon jobs against a used car.
ALTER TABLE repair_orders
  ADD COLUMN IF NOT EXISTS used_car_id INTEGER REFERENCES used_cars(id),
  ADD COLUMN IF NOT EXISTS internal BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE repair_orders ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE repair_orders ALTER COLUMN vehicle_id  DROP NOT NULL;

CREATE INDEX IF NOT EXISTS repair_orders_used_car_id_idx ON repair_orders(used_car_id);
CREATE INDEX IF NOT EXISTS repair_orders_internal_idx    ON repair_orders(internal);

-- 3) time_entries: link clock-in/out sessions to a specific repair order so
--    recon labor cost can be computed per car.
ALTER TABLE time_entries
  ADD COLUMN IF NOT EXISTS repair_order_id INTEGER REFERENCES repair_orders(id);

CREATE INDEX IF NOT EXISTS time_entries_repair_order_id_idx ON time_entries(repair_order_id);

COMMIT;
