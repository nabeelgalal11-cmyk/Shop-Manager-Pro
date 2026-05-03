-- Task #18: Inventory integrity & COGS
-- Apply with: psql "$DATABASE_URL" -f lib/db/migrations/2026-05-03_inventory_cogs.sql

BEGIN;

-- 1) stock_movements audit table — every +/− change to inventory.quantity
CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  inventory_id INTEGER NOT NULL REFERENCES inventory(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_table TEXT,
  reference_id INTEGER,
  reference_line_id INTEGER,
  unit_cost NUMERIC(10, 2),
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by_id INTEGER
);

CREATE INDEX IF NOT EXISTS stock_movements_inventory_id_idx
  ON stock_movements(inventory_id);
CREATE INDEX IF NOT EXISTS stock_movements_reference_idx
  ON stock_movements(reference_table, reference_id);

-- Idempotency lookup index. Originally a UNIQUE index, but that prevented
-- legitimate re-application after a compensating reversal (e.g. RO completed
-- -> incomplete -> completed must re-write a fresh ro_consumed row).
-- Idempotency is now enforced in application code by counting applies vs
-- reverses for the same source key. Drop any prior variant first (unique,
-- or non-unique with a COALESCE expression that confused drizzle-kit's
-- opclass inference) so environments converge on plain column form.
DROP INDEX IF EXISTS stock_movements_unique_source_idx;
DROP INDEX IF EXISTS stock_movements_source_idx;
CREATE INDEX IF NOT EXISTS stock_movements_source_idx
  ON stock_movements (
    inventory_id, reference_table, reference_id, reference_line_id, reason
  );

-- 2) line_items: capture unit_cost at time of consumption for COGS
ALTER TABLE line_items
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(10, 2);

-- 3) Pre-create the email_templates(key) unique constraint so the subsequent
--    drizzle-kit push does not prompt for a name and hang on stdin in CI.
--    Dedup any existing duplicate keys first (keep the lowest id).
DELETE FROM email_templates a
USING email_templates b
WHERE a.id > b.id AND a.key = b.key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'email_templates_key_unique'
  ) THEN
    ALTER TABLE email_templates
      ADD CONSTRAINT email_templates_key_unique UNIQUE (key);
  END IF;
END $$;

COMMIT;
