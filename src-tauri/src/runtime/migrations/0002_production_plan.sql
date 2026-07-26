CREATE TABLE IF NOT EXISTS production_sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  review_policy TEXT NOT NULL CHECK(review_policy IN ('guided', 'balanced', 'autonomous')),
  primary_skill_snapshot_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_production_sessions_project
  ON production_sessions(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS production_spec_revisions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES production_sessions(id) ON DELETE RESTRICT,
  revision_no INTEGER NOT NULL CHECK(revision_no > 0),
  parent_revision_id TEXT REFERENCES production_spec_revisions(id) ON DELETE RESTRICT,
  schema_version TEXT NOT NULL,
  core_json TEXT NOT NULL,
  extension_json TEXT NOT NULL,
  spec_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, revision_no),
  UNIQUE(session_id, spec_hash)
);

CREATE TABLE IF NOT EXISTS production_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES production_sessions(id) ON DELETE RESTRICT,
  spec_revision_id TEXT NOT NULL REFERENCES production_spec_revisions(id) ON DELETE RESTRICT,
  review_policy TEXT NOT NULL CHECK(review_policy IN ('guided', 'balanced', 'autonomous')),
  status TEXT NOT NULL CHECK(status IN (
    'preparing', 'action_required', 'queued', 'running', 'recovering',
    'canceling', 'completed', 'completed_with_warnings', 'failed', 'canceled'
  )),
  blockers_json TEXT NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_production_runs_session
  ON production_runs(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stage_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES production_runs(id) ON DELETE RESTRICT,
  stage_key TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  spec_path TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN (
    'pending', 'ready', 'running', 'blocked',
    'succeeded', 'failed', 'skipped', 'canceled'
  )),
  input_hash TEXT NOT NULL,
  blocked_reason_json TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(run_id, stage_key)
);

CREATE INDEX IF NOT EXISTS idx_stage_runs_run_status
  ON stage_runs(run_id, status, stage_key);

CREATE TABLE IF NOT EXISTS stage_dependencies (
  stage_run_id TEXT NOT NULL REFERENCES stage_runs(id) ON DELETE RESTRICT,
  depends_on_stage_run_id TEXT NOT NULL REFERENCES stage_runs(id) ON DELETE RESTRICT,
  dependency_kind TEXT NOT NULL CHECK(dependency_kind IN ('artifact', 'approval', 'ordering')),
  PRIMARY KEY(stage_run_id, depends_on_stage_run_id)
);

CREATE TABLE IF NOT EXISTS workflow_plan_projections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES production_sessions(id) ON DELETE RESTRICT,
  spec_revision_id TEXT NOT NULL REFERENCES production_spec_revisions(id) ON DELETE RESTRICT,
  run_id TEXT NOT NULL UNIQUE REFERENCES production_runs(id) ON DELETE RESTRICT,
  projection_version INTEGER NOT NULL CHECK(projection_version > 0),
  projection_json TEXT NOT NULL,
  projection_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_plan_projections_project
  ON workflow_plan_projections(project_id, created_at DESC);
