ALTER TABLE stage_runs ADD COLUMN input_json TEXT;
ALTER TABLE stage_runs ADD COLUMN task_id TEXT;
ALTER TABLE stage_runs ADD COLUMN result_json TEXT;

CREATE TABLE IF NOT EXISTS production_gates (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES production_runs(id) ON DELETE RESTRICT,
  gate_kind TEXT NOT NULL CHECK(gate_kind IN ('system', 'director', 'user')),
  gate_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('required', 'approved', 'rejected', 'waived')),
  decision_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(run_id, gate_type)
);

CREATE TABLE IF NOT EXISTS run_route_plans (
  run_id TEXT PRIMARY KEY REFERENCES production_runs(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK(status IN ('proposed', 'confirmed', 'rejected')),
  plan_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS run_budgets (
  run_id TEXT PRIMARY KEY REFERENCES production_runs(id) ON DELETE RESTRICT,
  hard_limit_micros INTEGER NOT NULL CHECK(hard_limit_micros > 0),
  unit_code TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_ledger (
  entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES production_runs(id) ON DELETE RESTRICT,
  stage_run_id TEXT REFERENCES stage_runs(id) ON DELETE RESTRICT,
  entry_kind TEXT NOT NULL CHECK(entry_kind IN ('reserve', 'confirm', 'release')),
  amount_micros INTEGER NOT NULL,
  unit_code TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_ledger_run
  ON usage_ledger(run_id, entry_id);
