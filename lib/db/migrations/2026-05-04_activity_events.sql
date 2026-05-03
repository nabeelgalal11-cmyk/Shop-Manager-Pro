BEGIN;

CREATE TABLE IF NOT EXISTS activity_events (
  id serial PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id integer NOT NULL,
  event_type text NOT NULL,
  actor_id integer REFERENCES employees(id) ON DELETE SET NULL,
  actor_label text,
  meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_events_entity_idx
  ON activity_events (entity_type, entity_id, created_at DESC);

COMMIT;
