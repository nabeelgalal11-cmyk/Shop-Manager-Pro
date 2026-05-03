-- Task #18 follow-up: drop the over-strict unique idempotency index.
-- The original index treated (inventory, reason, ref_table, ref_id, line_id)
-- as permanently unique, which prevented legitimate re-application after a
-- compensating reversal (e.g. RO completed -> incomplete -> completed must
-- re-write a fresh ro_consumed row, but the unique index blocked it).
-- Idempotency is now enforced in application code by counting applies vs
-- reverses for the same source key (event-aware, supports unlimited cycles).

BEGIN;

DROP INDEX IF EXISTS stock_movements_unique_source_idx;

-- Keep a non-unique composite index so the count(apply) - count(reverse)
-- lookups in code stay fast.
CREATE INDEX IF NOT EXISTS stock_movements_source_idx
  ON stock_movements (
    inventory_id, reference_table, reference_id,
    COALESCE(reference_line_id, 0), reason
  );

COMMIT;
