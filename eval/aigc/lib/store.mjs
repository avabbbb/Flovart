// Results store for the AIGC eval platform (eval/aigc/results/, gitignored).
//
// Primary backend: node:sqlite (built into Node >= 22.5, loaded lazily so a
// runtime without it still works). Fallback: append-only JSONL files with the
// same records. Force the fallback with FLOVART_AIGC_STORE=jsonl.
// The store holds grades, withdrawals, ratings and take metadata — never media.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function loadSqlite() {
  // node:sqlite prints an ExperimentalWarning on first load; silence only that one.
  const emitWarning = process.emitWarning;
  process.emitWarning = (warning, ...rest) => {
    if (String(warning?.message ?? warning).includes('SQLite')) return;
    emitWarning.call(process, warning, ...rest);
  };
  try {
    const builtin = process.getBuiltinModule?.('node:sqlite');
    return builtin?.DatabaseSync ? builtin : null;
  } catch {
    return null;
  } finally {
    process.emitWarning = emitWarning;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, kind TEXT NOT NULL, created_at TEXT NOT NULL, meta TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grades (run_id TEXT NOT NULL, item_id TEXT NOT NULL, take_id TEXT NOT NULL, verdict TEXT NOT NULL,
  withdrawn_reason TEXT, results TEXT NOT NULL, checks TEXT NOT NULL, PRIMARY KEY (run_id, take_id));
CREATE TABLE IF NOT EXISTS withdrawals (run_id TEXT NOT NULL, item_id TEXT NOT NULL, reason TEXT NOT NULL, PRIMARY KEY (run_id, item_id));
CREATE TABLE IF NOT EXISTS ratings (take_id TEXT NOT NULL, item_id TEXT NOT NULL, rater TEXT NOT NULL, rater_kind TEXT NOT NULL,
  dim TEXT NOT NULL, score INTEGER NOT NULL, rubric TEXT, at TEXT, audit_of TEXT NOT NULL DEFAULT '', reason TEXT,
  PRIMARY KEY (take_id, dim, rater, audit_of));
CREATE TABLE IF NOT EXISTS takes (take_id TEXT PRIMARY KEY, item_id TEXT NOT NULL, json TEXT NOT NULL);
`;

const ratingKey = rating => `${rating.takeId}/${rating.dim}/${rating.rater}/${rating.audit?.of ?? ''}`;

function sqliteStore(dir, sqlite) {
  const db = new sqlite.DatabaseSync(join(dir, 'aigc.sqlite'));
  db.exec(SCHEMA);
  const tx = fn => { db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } };
  return {
    backend: 'sqlite',
    addGradeRun({ runId, createdAt, meta = {}, grades, withdrawals }) {
      tx(() => {
        db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?)').run(runId, 'grade', createdAt, JSON.stringify(meta));
        const insertGrade = db.prepare('INSERT INTO grades VALUES (?, ?, ?, ?, ?, ?, ?)');
        for (const grade of grades) insertGrade.run(runId, grade.itemId, grade.takeId, grade.verdict, grade.withdrawn?.reason ?? null, JSON.stringify(grade.results), JSON.stringify(grade.checks ?? {}));
        const insertWithdrawal = db.prepare('INSERT INTO withdrawals VALUES (?, ?, ?)');
        for (const entry of withdrawals) insertWithdrawal.run(runId, entry.itemId, entry.reason);
      });
    },
    addRatings(ratings) {
      const insert = db.prepare('INSERT OR REPLACE INTO ratings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      tx(() => { for (const r of ratings) insert.run(r.takeId, r.itemId, r.rater, r.raterKind, r.dim, r.score, r.rubric ?? null, r.at ?? null, r.audit?.of ?? '', r.reason ?? null); });
    },
    addTakes(takes) {
      const insert = db.prepare('INSERT OR REPLACE INTO takes VALUES (?, ?, ?)');
      tx(() => { for (const take of takes) insert.run(take.takeId, take.itemId, JSON.stringify(take)); });
    },
    latestGradeRun() {
      const run = db.prepare("SELECT * FROM runs WHERE kind = 'grade' ORDER BY created_at DESC, run_id DESC LIMIT 1").get();
      if (!run) return null;
      const grades = db.prepare('SELECT * FROM grades WHERE run_id = ?').all(run.run_id).map(row => ({
        itemId: row.item_id, takeId: row.take_id, verdict: row.verdict,
        withdrawn: row.withdrawn_reason ? { reason: row.withdrawn_reason } : null,
        results: JSON.parse(row.results), checks: JSON.parse(row.checks),
      }));
      const withdrawals = db.prepare('SELECT item_id, reason FROM withdrawals WHERE run_id = ?').all(run.run_id).map(row => ({ itemId: row.item_id, reason: row.reason }));
      return { runId: run.run_id, createdAt: run.created_at, meta: JSON.parse(run.meta), grades, withdrawals };
    },
    ratings() {
      return db.prepare('SELECT * FROM ratings').all().map(row => ({
        takeId: row.take_id, itemId: row.item_id, rater: row.rater, raterKind: row.rater_kind, dim: row.dim, score: Number(row.score),
        ...(row.rubric ? { rubric: row.rubric } : {}), ...(row.at ? { at: row.at } : {}), ...(row.reason ? { reason: row.reason } : {}),
        ...(row.audit_of ? { audit: { of: row.audit_of } } : {}),
      }));
    },
    takes() {
      return db.prepare('SELECT json FROM takes').all().map(row => JSON.parse(row.json));
    },
    close() { db.close(); },
  };
}

function jsonlStore(dir) {
  const file = name => join(dir, `${name}.jsonl`);
  const append = (name, records) => { if (records.length) appendFileSync(file(name), records.map(record => JSON.stringify(record)).join('\n') + '\n'); };
  const read = name => (existsSync(file(name)) ? readFileSync(file(name), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : []);
  const lastWins = (records, key) => [...new Map(records.map(record => [key(record), record])).values()];
  return {
    backend: 'jsonl',
    addGradeRun({ runId, createdAt, meta = {}, grades, withdrawals }) {
      append('runs', [{ runId, kind: 'grade', createdAt, meta }]);
      append('grades', grades.map(grade => ({ runId, ...grade })));
      append('withdrawals', withdrawals.map(entry => ({ runId, itemId: entry.itemId, reason: entry.reason })));
    },
    addRatings(ratings) { append('ratings', ratings); },
    addTakes(takes) { append('takes', takes); },
    latestGradeRun() {
      const runs = read('runs').filter(run => run.kind === 'grade').sort((a, b) => `${a.createdAt}${a.runId}`.localeCompare(`${b.createdAt}${b.runId}`));
      const run = runs.at(-1);
      if (!run) return null;
      const grades = read('grades').filter(grade => grade.runId === run.runId).map(({ runId, ...grade }) => grade);
      const withdrawals = read('withdrawals').filter(entry => entry.runId === run.runId).map(({ runId, ...entry }) => entry);
      return { runId: run.runId, createdAt: run.createdAt, meta: run.meta, grades, withdrawals };
    },
    ratings() { return lastWins(read('ratings'), ratingKey); },
    takes() { return lastWins(read('takes'), take => take.takeId); },
    close() {},
  };
}

/** Open (and create) the store in `dir`. backend: 'auto' | 'sqlite' | 'jsonl'. */
export function openStore(dir, { backend = process.env.FLOVART_AIGC_STORE || 'auto' } = {}) {
  mkdirSync(dir, { recursive: true });
  if (backend !== 'jsonl') {
    const sqlite = loadSqlite();
    if (sqlite) return sqliteStore(dir, sqlite);
    if (backend === 'sqlite') throw new Error('node:sqlite is not available in this Node runtime');
  }
  return jsonlStore(dir);
}
