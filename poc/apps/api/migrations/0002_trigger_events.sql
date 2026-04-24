CREATE TABLE trigger_events (
  id TEXT PRIMARY KEY NOT NULL,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  trigger_key TEXT NOT NULL,
  event TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  is_stale INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_trigger_events_workflow
  ON trigger_events (workflow_id, captured_at DESC);
