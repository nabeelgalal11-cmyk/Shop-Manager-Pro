-- Task #23: Per-user board column preferences (order + visibility).
-- Stores one row per (user, board_key) so the repair-orders board (and any
-- future boards) can persist a user-specific column layout server-side
-- instead of only in localStorage. Idempotent so it is safe to re-run on
-- environments where it has already been applied via earlier hot-fix SQL.

BEGIN;

CREATE TABLE IF NOT EXISTS user_board_preferences (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  board_key       TEXT    NOT NULL,
  column_order    TEXT[]  NOT NULL DEFAULT '{}',
  hidden_columns  TEXT[]  NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Drizzle schema declares a unique index on (userId, boardKey); upserts in
-- the API route rely on it as the conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS user_board_preferences_user_board_idx
  ON user_board_preferences (user_id, board_key);

COMMIT;
