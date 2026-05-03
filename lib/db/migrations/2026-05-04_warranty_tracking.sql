BEGIN;

-- Per-line warranty fields on line_items (covers parts and labor on
-- both estimates and invoices). Months from completion; miles from
-- vehicle mileage at completion.
ALTER TABLE line_items
  ADD COLUMN IF NOT EXISTS warranty_months integer,
  ADD COLUMN IF NOT EXISTS warranty_miles  integer;

-- Default warranty values on inventory items, used to pre-fill line
-- items / RO parts when the part is added from inventory.
ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS default_warranty_months integer,
  ADD COLUMN IF NOT EXISTS default_warranty_miles  integer;

-- canned_jobs.items is jsonb; the per-item warranty fields are stored
-- inside that blob, no schema change needed there. Same for the
-- repair_orders.parts jsonb array.

COMMIT;
