BEGIN;

-- Inventory parts can optionally be limited to specific vehicle fitments.
-- A blank value means the part is universal.
ALTER TABLE inventory
  ADD COLUMN IF NOT EXISTS compatible_vehicles text;

COMMIT;