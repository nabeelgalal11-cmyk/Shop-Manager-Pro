BEGIN;

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS repair_order_id integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'estimates_repair_order_id_repair_orders_id_fk'
      AND conrelid = 'estimates'::regclass
  ) THEN
    ALTER TABLE estimates
      ADD CONSTRAINT estimates_repair_order_id_repair_orders_id_fk
      FOREIGN KEY (repair_order_id) REFERENCES repair_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS estimates_repair_order_idx
  ON estimates (repair_order_id);

-- Recover links written by the pre-column conversion flow. Only numeric IDs
-- that still point at a real repair order are eligible; existing links win.
UPDATE estimates e
SET repair_order_id = recovered.repair_order_id
FROM (
  SELECT DISTINCT ON (ee.estimate_id)
    ee.estimate_id,
    (ee.metadata->>'repairOrderId')::integer AS repair_order_id
  FROM estimate_events ee
  JOIN repair_orders ro
    ON ro.id = CASE
      WHEN (ee.metadata->>'repairOrderId') ~ '^[1-9][0-9]{0,8}$'
        THEN (ee.metadata->>'repairOrderId')::integer
      ELSE NULL
    END
  WHERE ee.event = 'converted_to_ro'
  ORDER BY ee.estimate_id, ee.created_at DESC, ee.id DESC
) recovered
WHERE e.id = recovered.estimate_id
  AND e.repair_order_id IS NULL;

COMMIT;