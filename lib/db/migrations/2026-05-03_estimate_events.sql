BEGIN;

CREATE TABLE IF NOT EXISTS estimate_events (
  id serial PRIMARY KEY,
  estimate_id integer NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  event text NOT NULL,
  actor text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS estimate_events_estimate_idx
  ON estimate_events (estimate_id, created_at);

COMMIT;
