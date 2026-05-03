BEGIN;

CREATE TABLE IF NOT EXISTS suppliers (
  id serial PRIMARY KEY,
  name text NOT NULL,
  account_number text,
  payment_terms text,
  contact_name text,
  contact_email text,
  contact_phone text,
  address text,
  notes text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_name_lower_unique
  ON suppliers (lower(name));

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS supplier_id integer
    REFERENCES suppliers(id) ON DELETE SET NULL;

-- Backfill suppliers from distinct purchases.supplier text. Uses DISTINCT ON
-- against lower(trim(supplier)) so casing differences collapse to one row.
INSERT INTO suppliers (name, contact_name, contact_email, contact_phone)
SELECT DISTINCT ON (lower(trim(supplier)))
  trim(supplier),
  supplier_contact,
  supplier_email,
  supplier_phone
FROM purchases
WHERE supplier IS NOT NULL AND trim(supplier) <> ''
ORDER BY lower(trim(supplier)), id DESC
ON CONFLICT DO NOTHING;

UPDATE purchases p
SET supplier_id = s.id
FROM suppliers s
WHERE lower(trim(p.supplier)) = lower(s.name)
  AND p.supplier_id IS NULL;

-- Preserve the original free-text value for audit. Drop NOT NULL so future
-- purchases can be created with supplier_id only.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchases' AND column_name = 'supplier'
  ) THEN
    EXECUTE 'ALTER TABLE purchases RENAME COLUMN supplier TO supplier_legacy';
  END IF;
END $$;

ALTER TABLE purchases ALTER COLUMN supplier_legacy DROP NOT NULL;

ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS preferred_supplier_id integer
    REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS purchases_supplier_id_idx
  ON purchases (supplier_id);
CREATE INDEX IF NOT EXISTS inventory_preferred_supplier_id_idx
  ON inventory (preferred_supplier_id);

COMMIT;
