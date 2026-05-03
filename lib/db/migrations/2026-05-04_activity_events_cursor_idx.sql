CREATE INDEX IF NOT EXISTS activity_events_entity_cursor_idx
  ON activity_events (entity_type, entity_id, id);
