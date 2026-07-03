ALTER TABLE used_cars
  ADD COLUMN IF NOT EXISTS buyer_id integer REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS sale_invoice_id integer REFERENCES invoices(id);
