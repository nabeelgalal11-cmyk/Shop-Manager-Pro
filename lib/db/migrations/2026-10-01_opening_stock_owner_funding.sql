BEGIN;

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS effective_date date;

UPDATE stock_movements
  SET effective_date = created_at::date
  WHERE effective_date IS NULL;

ALTER TABLE stock_movements
  ALTER COLUMN effective_date SET DEFAULT CURRENT_DATE;

ALTER TABLE stock_movements
  ALTER COLUMN effective_date SET NOT NULL;

INSERT INTO stock_movements
  (inventory_id, delta, reason, reference_table, reference_id, unit_cost, notes, effective_date, created_at)
SELECT i.id, i.quantity, 'opening_balance', 'inventory', i.id, i.cost_price,
       'Opening stock carried forward from inventory record', i.created_at::date, i.created_at
FROM inventory i
WHERE i.quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements sm WHERE sm.inventory_id = i.id
  );

CREATE TABLE IF NOT EXISTS owner_funding_entries (
  id serial PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('loan', 'contribution', 'repayment')),
  amount numeric(10, 2) NOT NULL CHECK (amount > 0),
  entry_date date NOT NULL,
  description text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_id integer
);

CREATE INDEX IF NOT EXISTS owner_funding_entries_entry_date_idx
  ON owner_funding_entries (entry_date, id);

COMMIT;