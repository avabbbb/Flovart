// 由 contracts/runtime/migrations/0005_agent_pipeline.sql 生成，内容必须逐字相同（tests/pipelineSchema.test.js 校验）。
// 用 JS 字符串而不是 readFileSync：agent sidecar 打成单文件 SEA 时没有可读的相对路径。
export const PIPELINE_MIGRATION_VERSION = 5;
export const PIPELINE_MIGRATION_SQL = `-- Agent 视频流水线 trace（docs/design/16-agent-video-pipeline.md §4.2 / §12）。
-- 唯一来源：Rust Runtime（src-tauri/src/runtime/store.rs，migration 5）与
-- Node pipeline 边界（tools/flovart/pipeline/store.js）都执行这一份 SQL，
-- 写入同一个 flovart-state.db。只追加新迁移，不修改已发布内容。
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'blocked', 'passed', 'archived', 'stopped')),
  brief_json TEXT NOT NULL,
  brief_artifact_id TEXT,
  budget_json TEXT NOT NULL,
  reference_json TEXT,
  blocker_json TEXT,
  head_version INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
  seq INTEGER NOT NULL,
  tool TEXT NOT NULL,
  caller TEXT NOT NULL,
  mutation_id TEXT,
  args_digest TEXT NOT NULL,
  args_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'canceled', 'unknown_submit')),
  paid INTEGER NOT NULL DEFAULT 0,
  cost_micros INTEGER NOT NULL DEFAULT 0,
  artifact_ids_json TEXT NOT NULL DEFAULT '[]',
  result_json TEXT,
  error_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  UNIQUE(run_id, seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_run_steps_mutation ON run_steps(run_id, tool, mutation_id) WHERE mutation_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS pipeline_artifacts (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  run_id TEXT,
  step_id TEXT,
  version INTEGER,
  kind TEXT NOT NULL,
  mime TEXT,
  ext TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  path TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  media_json TEXT,
  source_json TEXT,
  params_json TEXT,
  rejected INTEGER NOT NULL DEFAULT 0,
  rejected_reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pipeline_artifacts_run ON pipeline_artifacts(run_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_artifacts_run_sha ON pipeline_artifacts(IFNULL(run_id, ''), sha256, kind);
CREATE TABLE IF NOT EXISTS pipeline_spec_versions (
  run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
  version INTEGER NOT NULL,
  parent_version INTEGER,
  spec_json TEXT NOT NULL,
  spec_sha256 TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  step_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(run_id, version)
);
CREATE TABLE IF NOT EXISTS pipeline_renders (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
  version INTEGER NOT NULL,
  preset TEXT NOT NULL,
  at_sec REAL,
  engine TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  probe_json TEXT,
  step_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS review_rounds (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
  round INTEGER NOT NULL,
  version INTEGER NOT NULL,
  reviewer TEXT NOT NULL,
  caller TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK(verdict IN ('pass', 'revise', 'block')),
  findings_json TEXT NOT NULL,
  fixed_by_version INTEGER,
  step_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(run_id, round)
);
CREATE TABLE IF NOT EXISTS pipeline_usage_ledger (
  entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES pipeline_runs(id),
  step_id TEXT NOT NULL,
  entry_kind TEXT NOT NULL CHECK(entry_kind IN ('reserve', 'confirm', 'release')),
  amount_micros INTEGER NOT NULL,
  tasks INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at INTEGER NOT NULL
);
`;
