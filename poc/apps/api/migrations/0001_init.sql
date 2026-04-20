-- Migration 0001: initial schema
-- Replaces the Cloudflare KV namespace with a D1 SQLite database.

CREATE TABLE workflows (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'draft',
  external_user_id TEXT NOT NULL,
  deployed_trigger_id TEXT,
  custom_trigger_id   TEXT,
  last_error       TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE INDEX idx_workflows_user ON workflows (external_user_id);
CREATE INDEX idx_workflows_ct   ON workflows (custom_trigger_id)
  WHERE custom_trigger_id IS NOT NULL;

-- Steps are stored as individual rows rather than a serialised JSON array.
-- The `data` column holds the per-step PipedreamStep / CustomTriggerStep JSON;
-- snapshot fields are also JSON but are not queried — only read/written whole.
CREATE TABLE workflow_steps (
  id               TEXT PRIMARY KEY,
  workflow_id      TEXT NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
  step_order       INTEGER NOT NULL,
  type             TEXT NOT NULL,
  data             TEXT,
  output_schema    TEXT,
  output_snapshot  TEXT,
  tested           INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_steps_workflow ON workflow_steps (workflow_id, step_order);

CREATE TABLE execution_runs (
  id               TEXT PRIMARY KEY,
  workflow_id      TEXT NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
  external_user_id TEXT NOT NULL,
  trigger_source   TEXT NOT NULL,
  trigger_event_id TEXT,
  trigger_event    TEXT NOT NULL DEFAULT '{}',
  status           TEXT NOT NULL DEFAULT 'running',
  started_at       TEXT NOT NULL,
  completed_at     TEXT,
  error            TEXT
);

CREATE INDEX idx_runs_workflow ON execution_runs (workflow_id, started_at DESC);

CREATE TABLE execution_step_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        TEXT    NOT NULL REFERENCES execution_runs (id) ON DELETE CASCADE,
  step_order    INTEGER NOT NULL,
  step_id       TEXT    NOT NULL,
  component_key TEXT    NOT NULL,
  started_at    TEXT    NOT NULL,
  completed_at  TEXT    NOT NULL,
  status        TEXT    NOT NULL,
  output        TEXT,
  error         TEXT
);

CREATE INDEX idx_step_results_run ON execution_step_results (run_id, step_order);
