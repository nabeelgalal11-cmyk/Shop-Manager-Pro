-- Part prices may be entered as tax-inclusive values. Preserve the flag
-- through authorization and invoicing so those lines are not taxed again.
ALTER TABLE estimate_items
  ADD COLUMN IF NOT EXISTS price_includes_tax boolean NOT NULL DEFAULT false;

ALTER TABLE repair_order_work_items
  ADD COLUMN IF NOT EXISTS price_includes_tax boolean NOT NULL DEFAULT false;

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS price_includes_tax boolean NOT NULL DEFAULT false;