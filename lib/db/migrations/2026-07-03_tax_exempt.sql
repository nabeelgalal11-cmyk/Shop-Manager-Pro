ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_exempt_number text;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_exempt boolean NOT NULL DEFAULT false;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_exempt_number text;
