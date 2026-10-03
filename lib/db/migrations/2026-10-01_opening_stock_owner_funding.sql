BEGIN;

ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS effective_date date;

ALTER TABLE stock_movements
  ALTER COLUMN effective_date SET DEFAULT CURRENT_DATE;

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

-- Run this file with psql in autocommit mode. Commit bounded updates outside
-- the DDL transaction so ALTER TABLE's ACCESS EXCLUSIVE lock is not held over
-- the full historical rewrite.
CREATE OR REPLACE PROCEDURE backfill_stock_movement_effective_dates()
LANGUAGE plpgsql
AS $$
DECLARE
  v_last_id integer := 0;
  v_row_count bigint;
BEGIN
  LOOP
    WITH batch AS (
      SELECT id
      FROM stock_movements
      WHERE id > v_last_id AND effective_date IS NULL
      ORDER BY id
      LIMIT 100000
      FOR UPDATE
    ),
    updated AS (
      UPDATE stock_movements AS sm
      SET effective_date = sm.created_at::date
      FROM batch
      WHERE sm.id = batch.id
      RETURNING sm.id
    )
    SELECT max(id), count(*) INTO v_last_id, v_row_count
    FROM updated;

    EXIT WHEN v_row_count = 0;
    COMMIT;
    PERFORM pg_sleep(0.025);
  END LOOP;
END;
$$;

CALL backfill_stock_movement_effective_dates();
DROP PROCEDURE backfill_stock_movement_effective_dates();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'stock_movements'::regclass
      AND conname = 'stock_movements_effective_date_not_null_check'
  ) THEN
    ALTER TABLE stock_movements
      ADD CONSTRAINT stock_movements_effective_date_not_null_check
      CHECK (effective_date IS NOT NULL) NOT VALID;
  END IF;
END;
$$;

-- Validation scans without blocking normal reads and writes.
ALTER TABLE stock_movements
  VALIDATE CONSTRAINT stock_movements_effective_date_not_null_check;

BEGIN;

ALTER TABLE stock_movements
  ALTER COLUMN effective_date SET NOT NULL;

ALTER TABLE stock_movements
  DROP CONSTRAINT stock_movements_effective_date_not_null_check;

COMMIT;

BEGIN;

-- Serialize the existence check with legacy movement writers while still
-- allowing reporting and inventory-history reads.
LOCK TABLE stock_movements IN SHARE MODE;

INSERT INTO stock_movements
  (inventory_id, delta, reason, reference_table, reference_id, unit_cost, notes, effective_date, created_at)
SELECT i.id, i.quantity, 'opening_balance', 'inventory', i.id, i.cost_price,
       'Opening stock carried forward from inventory record', i.created_at::date, i.created_at
FROM inventory i
WHERE i.quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM stock_movements sm WHERE sm.inventory_id = i.id
  );

COMMIT;