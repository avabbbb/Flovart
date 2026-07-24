CREATE TABLE IF NOT EXISTS runtime_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS command_receipts (
  command_id TEXT PRIMARY KEY,
  actor_kind TEXT NOT NULL,
  actor_instance_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  command_name TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  task_id TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(actor_kind, actor_instance_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS runtime_tasks (
  id TEXT PRIMARY KEY,
  command_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'queued', 'working', 'input_required', 'completed', 'failed', 'cancelled'
  )),
  entity_type TEXT,
  entity_id TEXT,
  args_json TEXT NOT NULL,
  progress_json TEXT,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  cancel_requested_at INTEGER,
  result_json TEXT,
  error_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runtime_tasks_status_updated
  ON runtime_tasks(status, updated_at);

CREATE TABLE IF NOT EXISTS runtime_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_version TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  task_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_runtime_events_task
  ON runtime_events(task_id, event_id);
CREATE INDEX IF NOT EXISTS idx_runtime_events_entity
  ON runtime_events(entity_type, entity_id, event_id);

