#!/usr/bin/env node
// Multimodal AIGC eval platform CLI (eval/eval.md §4.1, docs/plans/aigc-eval-platform.md).
//
//   node eval/aigc/run.mjs validate     [--items <dir>] [--takes <file.jsonl>] [--ratings <file.jsonl>]
//   node eval/aigc/run.mjs fixtures     [--out <dir>]
//   node eval/aigc/run.mjs grade        --takes <file.jsonl> [--repeats 3] [--media-root <dir>] [--fixtures <dir>] [--store <dir>]
//   node eval/aigc/run.mjs rate         --ratings <file.jsonl> [--store <dir>]
//   node eval/aigc/run.mjs report       [--store <dir>] [--out <dir>]
//   node eval/aigc/run.mjs prefs-export --events <file.jsonl> [--out <dir>]
//   node eval/aigc/run.mjs demo         fixtures → validate → grade → rate → report on eval/aigc/samples
//
// Spends nothing: no generation, no provider calls, no judge calls. Grading is
// local ffprobe / ffmpeg; subjective scores come from recorded ratings.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ITEMS_DIR, loadItems, readJsonl, validateDataset } from './lib/dataset.mjs';
import { gradeAll } from './lib/grade.mjs';
import { openStore } from './lib/store.mjs';
import { buildReportModel, renderDashboard } from './lib/report.mjs';
import { exportPreferencePairs, finalChoices } from './lib/preferences.mjs';
import { ensureFixtures } from './lib/fixtures.mjs';
import { toolAvailable } from './graders/media.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(here, 'results');
const DEFAULT_FIXTURES = join(RESULTS_DIR, 'fixtures');
const SAMPLES = join(here, 'samples');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) args[token.slice(2)] = true;
      else { args[token.slice(2)] = next; i += 1; }
    } else args._.push(token);
  }
  return args;
}

const storeDir = args => resolve(args.store ?? RESULTS_DIR);
const timestamp = () => new Date().toISOString();
const runId = () => `${timestamp().replace(/[:.]/g, '-').slice(0, 19)}-grade`;

function cmdValidate(args) {
  const items = loadItems(resolve(args.items ?? ITEMS_DIR));
  const takes = args.takes ? readJsonl(resolve(args.takes)) : [];
  const ratings = args.ratings ? readJsonl(resolve(args.ratings)) : [];
  const { errors } = validateDataset({ items, takes, ratings });
  for (const error of errors) console.error(`error  ${error}`);
  console.log(JSON.stringify({ items: items.length, takes: takes.length, ratings: ratings.length, errors: errors.length }));
  return errors.length ? 1 : 0;
}

function cmdFixtures(args) {
  const { dir, generated } = ensureFixtures(resolve(args.out ?? DEFAULT_FIXTURES));
  console.log(JSON.stringify({ dir, generated }));
  return 0;
}

function cmdGrade(args) {
  if (!args.takes) throw new Error('grade needs --takes <file.jsonl>');
  if (!toolAvailable()) throw new Error('ffprobe is not available (set IRIS_FFPROBE / IRIS_FFMPEG); the objective track cannot run');
  const items = loadItems(resolve(args.items ?? ITEMS_DIR));
  const takes = readJsonl(resolve(args.takes));
  const { errors } = validateDataset({ items, takes });
  if (errors.length) { for (const error of errors) console.error(`error  ${error}`); return 1; }
  const ctx = { mediaRoot: resolve(args['media-root'] ?? here), fixturesDir: resolve(args.fixtures ?? DEFAULT_FIXTURES) };
  const repeats = Number(args.repeats ?? 3);
  const { grades, withdrawals, skipped } = gradeAll(items, takes, ctx, { repeats });
  const store = openStore(storeDir(args));
  const id = runId();
  store.addTakes(takes);
  store.addGradeRun({ runId: id, createdAt: timestamp(), meta: { takes: resolve(args.takes), repeats, skipped }, grades, withdrawals });
  store.close();
  const tally = grades.reduce((acc, grade) => ({ ...acc, [grade.verdict]: (acc[grade.verdict] ?? 0) + 1 }), {});
  console.log(JSON.stringify({ runId: id, backend: store.backend, verdicts: tally, withdrawn: withdrawals, skipped }));
  return 0;
}

function cmdRate(args) {
  if (!args.ratings) throw new Error('rate needs --ratings <file.jsonl>');
  const items = loadItems(resolve(args.items ?? ITEMS_DIR));
  const ratings = readJsonl(resolve(args.ratings));
  const store = openStore(storeDir(args));
  const { errors } = validateDataset({ items, takes: store.takes(), ratings });
  if (errors.length) { for (const error of errors) console.error(`error  ${error}`); store.close(); return 1; }
  store.addRatings(ratings);
  store.close();
  console.log(JSON.stringify({ imported: ratings.length, backend: store.backend }));
  return 0;
}

function cmdReport(args) {
  const items = loadItems(resolve(args.items ?? ITEMS_DIR));
  const store = openStore(storeDir(args));
  const model = buildReportModel({ items, takes: store.takes(), gradeRun: store.latestGradeRun(), ratings: store.ratings() });
  store.close();
  const out = resolve(args.out ?? join(storeDir(args), 'report'));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'report.json'), JSON.stringify(model, null, 2));
  writeFileSync(join(out, 'index.html'), renderDashboard(model));
  console.log(JSON.stringify({ out: join(out, 'index.html'), objective: model.objective.overall, withdrawn: model.withdrawn.length }));
  return 0;
}

function cmdPrefsExport(args) {
  if (!args.events) throw new Error('prefs-export needs --events <file.jsonl>');
  const events = readJsonl(resolve(args.events));
  const { pairs, truth } = exportPreferencePairs(events);
  const out = resolve(args.out ?? join(RESULTS_DIR, 'preferences'));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'pairs.jsonl'), pairs.map(pair => JSON.stringify(pair)).join('\n') + (pairs.length ? '\n' : ''));
  writeFileSync(join(out, 'truth.json'), JSON.stringify(truth, null, 2));
  console.log(JSON.stringify({ events: events.length, finalChoices: finalChoices(events).length, pairs: pairs.length, out }));
  return 0;
}

function cmdDemo(args) {
  const store = resolve(args.store ?? join(RESULTS_DIR, 'demo'));
  const steps = [
    () => cmdFixtures({}),
    () => cmdValidate({ takes: join(SAMPLES, 'takes.sample.jsonl'), ratings: join(SAMPLES, 'ratings.sample.jsonl') }),
    () => cmdGrade({ takes: join(SAMPLES, 'takes.sample.jsonl'), store }),
    () => cmdRate({ ratings: join(SAMPLES, 'ratings.sample.jsonl'), store }),
    () => cmdReport({ store }),
    () => cmdPrefsExport({ events: join(SAMPLES, 'preference-events.sample.jsonl'), out: join(store, 'preferences') }),
  ];
  for (const step of steps) { const code = step(); if (code) return code; }
  return 0;
}

const COMMANDS = { validate: cmdValidate, fixtures: cmdFixtures, grade: cmdGrade, rate: cmdRate, report: cmdReport, 'prefs-export': cmdPrefsExport, demo: cmdDemo };

const args = parseArgs(process.argv.slice(2));
const command = COMMANDS[args._[0]];
if (!command) {
  console.error(`usage: node eval/aigc/run.mjs <${Object.keys(COMMANDS).join('|')}> [options]`);
  process.exit(2);
}
try {
  process.exitCode = command(args);
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
