// Agent 视频流水线的本机持久层（docs/design/16-agent-video-pipeline.md §4.2）。
// 一个 SQLite 文件保存 run → step → artifact → version → render → review round；
// 一个内容寻址目录保存所有 durable artifact（sha256）。没有第二套任务系统：
// Step 由命令边界（./index.js）写入，模型不负责记账。
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';

// node:sqlite 在 Node 22 仍打印 ExperimentalWarning；只吞这一条，其它警告照常输出。
const originalEmitWarning = process.emitWarning;
process.emitWarning = function emitWarning(warning, ...rest) {
  const text = typeof warning === 'string' ? warning : warning?.message;
  if (typeof text === 'string' && text.includes('SQLite is an experimental feature')) return;
  return originalEmitWarning.call(process, warning, ...rest);
};
const { DatabaseSync } = await import('node:sqlite');
process.emitWarning = originalEmitWarning;

export function defaultPipelineHome() {
  if (process.env.FLOVART_PIPELINE_HOME) return process.env.FLOVART_PIPELINE_HOME;
  const base = process.env.LOCALAPPDATA || join(homedir(), '.flovart');
  return join(base, 'Flovart', 'pipeline');
}

const SCHEMA = `
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
CREATE TABLE IF NOT EXISTS artifacts (
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
CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_run_sha ON artifacts(IFNULL(run_id, ''), sha256, kind);
CREATE TABLE IF NOT EXISTS spec_versions (
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
CREATE TABLE IF NOT EXISTS renders (
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
CREATE TABLE IF NOT EXISTS run_usage_ledger (
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

const json = value => (value === undefined ? null : JSON.stringify(value));
const parse = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function sha256Text(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 稳定序列化：键排序，用于参数摘要与幂等比较。 */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
  '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain',
};

export class PipelineStore {
  constructor({ home = defaultPipelineHome() } = {}) {
    this.home = home;
    this.artifactRoot = join(home, 'artifacts');
    this.scratchRoot = join(home, 'scratch');
    mkdirSync(this.artifactRoot, { recursive: true });
    mkdirSync(this.scratchRoot, { recursive: true });
    this.db = new DatabaseSync(join(home, 'pipeline.sqlite'));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
  }

  close() { this.db.close(); }

  scratchPath(name) {
    const dir = join(this.scratchRoot, randomUUID());
    mkdirSync(dir, { recursive: true });
    return join(dir, name);
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // ---------- runs ----------
  createRun({ projectId, title, brief, budget, reference, createdBy }) {
    const id = `run_${randomUUID()}`;
    const now = Date.now();
    this.db.prepare(`INSERT INTO pipeline_runs
      (id, project_id, title, status, brief_json, budget_json, reference_json, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`)
      .run(id, projectId, title, json(brief), json(budget), json(reference ?? null), createdBy, now, now);
    return this.getRun(id);
  }

  getRun(runId) {
    const row = this.db.prepare('SELECT * FROM pipeline_runs WHERE id = ?').get(runId);
    if (!row) return null;
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      status: row.status,
      brief: parse(row.brief_json, {}),
      briefArtifactId: row.brief_artifact_id,
      budget: parse(row.budget_json, {}),
      reference: parse(row.reference_json),
      blocker: parse(row.blocker_json),
      headVersion: row.head_version,
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  updateRun(runId, patch) {
    const fields = [];
    const values = [];
    const map = { status: 'status', briefArtifactId: 'brief_artifact_id', headVersion: 'head_version' };
    for (const [key, column] of Object.entries(map)) {
      if (key in patch) { fields.push(`${column} = ?`); values.push(patch[key]); }
    }
    if ('blocker' in patch) { fields.push('blocker_json = ?'); values.push(json(patch.blocker)); }
    fields.push('updated_at = ?'); values.push(Date.now());
    this.db.prepare(`UPDATE pipeline_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values, runId);
    return this.getRun(runId);
  }

  listRuns(projectId) {
    const rows = projectId
      ? this.db.prepare('SELECT id FROM pipeline_runs WHERE project_id = ? ORDER BY created_at DESC').all(projectId)
      : this.db.prepare('SELECT id FROM pipeline_runs ORDER BY created_at DESC').all();
    return rows.map(row => this.getRun(row.id));
  }

  // ---------- steps ----------
  findStepByMutation(runId, tool, mutationId) {
    if (!mutationId) return null;
    const row = this.db.prepare('SELECT * FROM run_steps WHERE run_id = ? AND tool = ? AND mutation_id = ?').get(runId, tool, mutationId);
    return row ? this.#step(row) : null;
  }

  findStartStep(mutationId) {
    const row = this.db.prepare(`SELECT * FROM run_steps WHERE tool = 'pipeline.run.start' AND mutation_id = ?`).get(mutationId);
    return row ? this.#step(row) : null;
  }

  startStep({ runId, tool, caller, mutationId, argsDigest, args, paid }) {
    return this.transaction(() => {
      const seq = (this.db.prepare('SELECT IFNULL(MAX(seq), 0) AS seq FROM run_steps WHERE run_id = ?').get(runId).seq) + 1;
      const id = `step_${randomUUID()}`;
      this.db.prepare(`INSERT INTO run_steps
        (id, run_id, seq, tool, caller, mutation_id, args_digest, args_json, status, paid, started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`)
        .run(id, runId, seq, tool, caller, mutationId ?? null, argsDigest, json(args), paid ? 1 : 0, Date.now());
      return this.getStep(id);
    });
  }

  restartStep(stepId) {
    this.db.prepare(`UPDATE run_steps SET status = 'running', attempts = attempts + 1, error_json = NULL, finished_at = NULL WHERE id = ?`).run(stepId);
    return this.getStep(stepId);
  }

  finishStep(stepId, { status, result, error, artifactIds = [], costMicros = 0 }) {
    this.db.prepare(`UPDATE run_steps SET status = ?, result_json = ?, error_json = ?, artifact_ids_json = ?, cost_micros = ?, finished_at = ? WHERE id = ?`)
      .run(status, json(result ?? null), json(error ?? null), json(artifactIds), costMicros, Date.now(), stepId);
    return this.getStep(stepId);
  }

  getStep(stepId) {
    const row = this.db.prepare('SELECT * FROM run_steps WHERE id = ?').get(stepId);
    return row ? this.#step(row) : null;
  }

  listSteps(runId, since = 0) {
    return this.db.prepare('SELECT * FROM run_steps WHERE run_id = ? AND seq > ? ORDER BY seq').all(runId, since).map(row => this.#step(row));
  }

  #step(row) {
    return {
      id: row.id,
      runId: row.run_id,
      seq: row.seq,
      tool: row.tool,
      caller: row.caller,
      mutationId: row.mutation_id,
      argsDigest: row.args_digest,
      args: parse(row.args_json, {}),
      status: row.status,
      paid: Boolean(row.paid),
      costMicros: row.cost_micros,
      artifactIds: parse(row.artifact_ids_json, []),
      result: parse(row.result_json),
      error: parse(row.error_json),
      attempts: row.attempts,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }

  // ---------- artifacts ----------
  /**
   * 把一个本地文件收进内容寻址仓库。同一 run 里同一 sha256 + kind 只登记一次（内容哈希即幂等键）。
   * move=true 用于本流水线自己产出的临时文件，避免二次拷贝。
   */
  putFile(sourcePath, { runId = null, stepId = null, version = null, kind, tags = [], media = null, source = null, params = null, move = false, ext } = {}) {
    if (!existsSync(sourcePath)) throw Object.assign(new Error(`文件不存在：${sourcePath}`), { code: 'ASSET_MISSING' });
    const sha256 = sha256File(sourcePath);
    const existing = this.db.prepare(`SELECT id FROM artifacts WHERE IFNULL(run_id, '') = ? AND sha256 = ? AND kind = ?`).get(runId ?? '', sha256, kind);
    if (existing) return { ...this.getArtifact(existing.id), deduplicated: true };
    const extension = (ext || extname(sourcePath) || '.bin').toLowerCase();
    const dir = join(this.artifactRoot, sha256.slice(0, 2));
    mkdirSync(dir, { recursive: true });
    const target = join(dir, `${sha256}${extension}`);
    if (!existsSync(target)) {
      if (move) {
        try { renameSync(sourcePath, target); } catch { copyFileSync(sourcePath, target); }
      } else copyFileSync(sourcePath, target);
    }
    const id = `art_${sha256.slice(0, 12)}_${randomUUID().slice(0, 8)}`;
    this.db.prepare(`INSERT INTO artifacts
      (id, sha256, run_id, step_id, version, kind, mime, ext, bytes, path, tags_json, media_json, source_json, params_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, sha256, runId, stepId, version, kind, MIME_BY_EXT[extension] || 'application/octet-stream', extension,
        statSync(target).size, target, json(tags), json(media), json(source), json(params), Date.now());
    return this.getArtifact(id);
  }

  putText(text, name, options) {
    const path = this.scratchPath(name);
    writeFileSync(path, text, 'utf8');
    return this.putFile(path, { ...options, move: true });
  }

  getArtifact(artifactId) {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifactId);
    return row ? this.#artifact(row) : null;
  }

  requireArtifact(artifactId) {
    const artifact = this.getArtifact(artifactId);
    if (!artifact) throw Object.assign(new Error(`未知 artifact：${artifactId}`), { code: 'ARTIFACT_NOT_FOUND' });
    if (!existsSync(artifact.path)) throw Object.assign(new Error(`artifact 文件丢失：${artifactId}`), { code: 'ASSET_MISSING' });
    return artifact;
  }

  listArtifacts({ runId, kind, tags = [], includeRejected = true } = {}) {
    const clauses = [];
    const values = [];
    if (runId) { clauses.push('run_id = ?'); values.push(runId); }
    if (kind) { clauses.push('kind = ?'); values.push(kind); }
    if (!includeRejected) clauses.push('rejected = 0');
    const rows = this.db.prepare(`SELECT * FROM artifacts ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at`).all(...values);
    return rows.map(row => this.#artifact(row)).filter(item => tags.every(tag => item.tags.includes(tag)));
  }

  updateArtifactMedia(artifactId, media) {
    this.db.prepare('UPDATE artifacts SET media_json = ? WHERE id = ?').run(json(media), artifactId);
  }

  rejectArtifacts(artifactIds, reason) {
    const statement = this.db.prepare('UPDATE artifacts SET rejected = 1, rejected_reason = ? WHERE id = ?');
    for (const id of artifactIds) statement.run(reason, id);
  }

  #artifact(row) {
    return {
      id: row.id,
      sha256: row.sha256,
      runId: row.run_id,
      stepId: row.step_id,
      version: row.version,
      kind: row.kind,
      mime: row.mime,
      bytes: row.bytes,
      path: row.path,
      tags: parse(row.tags_json, []),
      media: parse(row.media_json),
      source: parse(row.source_json),
      params: parse(row.params_json),
      rejected: Boolean(row.rejected),
      rejectedReason: row.rejected_reason,
      createdAt: row.created_at,
    };
  }

  // ---------- spec versions ----------
  insertVersion({ runId, version, parentVersion, spec, diff, stepId }) {
    const specJson = canonicalJson(spec);
    this.db.prepare(`INSERT INTO spec_versions (run_id, version, parent_version, spec_json, spec_sha256, diff_json, step_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(runId, version, parentVersion ?? null, specJson, sha256Text(specJson), json(diff), stepId ?? null, Date.now());
    return this.getVersion(runId, version);
  }

  getVersion(runId, version) {
    const row = this.db.prepare('SELECT * FROM spec_versions WHERE run_id = ? AND version = ?').get(runId, version);
    if (!row) return null;
    return {
      runId: row.run_id,
      version: row.version,
      parentVersion: row.parent_version,
      spec: parse(row.spec_json),
      specSha256: row.spec_sha256,
      diff: parse(row.diff_json, {}),
      stepId: row.step_id,
      createdAt: row.created_at,
    };
  }

  listVersions(runId) {
    return this.db.prepare('SELECT version FROM spec_versions WHERE run_id = ? ORDER BY version').all(runId)
      .map(row => this.getVersion(runId, row.version));
  }

  // ---------- renders ----------
  insertRender({ runId, version, preset, atSec, engine, artifactId, probe, stepId }) {
    const id = `render_${randomUUID()}`;
    this.db.prepare(`INSERT INTO renders (id, run_id, version, preset, at_sec, engine, artifact_id, probe_json, step_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, runId, version, preset, atSec ?? null, engine, artifactId, json(probe ?? null), stepId ?? null, Date.now());
    return id;
  }

  listRenders(runId) {
    return this.db.prepare('SELECT * FROM renders WHERE run_id = ? ORDER BY created_at').all(runId).map(row => ({
      id: row.id,
      version: row.version,
      preset: row.preset,
      atSec: row.at_sec,
      engine: row.engine,
      artifactId: row.artifact_id,
      probe: parse(row.probe_json),
      stepId: row.step_id,
      createdAt: row.created_at,
    }));
  }

  latestRender(runId, version, preset) {
    return this.listRenders(runId).filter(item => item.version === version && (!preset || item.preset === preset)).at(-1) || null;
  }

  // ---------- reviews ----------
  insertReview({ runId, version, reviewer, caller, verdict, findings, stepId }) {
    return this.transaction(() => {
      const round = (this.db.prepare('SELECT IFNULL(MAX(round), 0) AS round FROM review_rounds WHERE run_id = ?').get(runId).round) + 1;
      const id = `round_${randomUUID()}`;
      this.db.prepare(`INSERT INTO review_rounds (id, run_id, round, version, reviewer, caller, verdict, findings_json, step_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, runId, round, version, reviewer, caller, verdict, json(findings), stepId ?? null, Date.now());
      return this.listReviews(runId).find(item => item.id === id);
    });
  }

  markReviewFixed(runId, version, fixedByVersion) {
    this.db.prepare(`UPDATE review_rounds SET fixed_by_version = ? WHERE run_id = ? AND version = ? AND verdict = 'revise' AND fixed_by_version IS NULL`)
      .run(fixedByVersion, runId, version);
  }

  listReviews(runId) {
    return this.db.prepare('SELECT * FROM review_rounds WHERE run_id = ? ORDER BY round').all(runId).map(row => ({
      id: row.id,
      round: row.round,
      version: row.version,
      reviewer: row.reviewer,
      caller: row.caller,
      verdict: row.verdict,
      findings: parse(row.findings_json, []),
      fixedByVersion: row.fixed_by_version,
      stepId: row.step_id,
      createdAt: row.created_at,
    }));
  }

  // ---------- usage ----------
  ledger(runId, { stepId, kind, amountMicros = 0, tasks = 0, note = null }) {
    this.db.prepare(`INSERT INTO run_usage_ledger (run_id, step_id, entry_kind, amount_micros, tasks, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(runId, stepId, kind, amountMicros, tasks, note, Date.now());
  }

  spend(runId) {
    const rows = this.db.prepare('SELECT entry_kind, SUM(amount_micros) AS amount, SUM(tasks) AS tasks FROM run_usage_ledger WHERE run_id = ? GROUP BY entry_kind').all(runId);
    const total = { reserve: { amount: 0, tasks: 0 }, confirm: { amount: 0, tasks: 0 }, release: { amount: 0, tasks: 0 } };
    for (const row of rows) total[row.entry_kind] = { amount: row.amount || 0, tasks: row.tasks || 0 };
    return {
      confirmedMicros: total.confirm.amount,
      confirmedTasks: total.confirm.tasks,
      // 已预留但未确认/释放的部分（进行中的付费调用）。
      pendingMicros: Math.max(0, total.reserve.amount - total.confirm.amount - total.release.amount),
      pendingTasks: Math.max(0, total.reserve.tasks - total.confirm.tasks - total.release.tasks),
      entries: this.db.prepare('SELECT * FROM run_usage_ledger WHERE run_id = ? ORDER BY entry_id').all(runId),
    };
  }
}
