#!/usr/bin/env node
// FlovartBench CLI.
//
// Entry points (E12):
//   npm run eval:validate   -> node eval/run.mjs validate
//   npm run eval:oracle     -> node eval/run.mjs oracle
//   npm run eval:core       -> node eval/run.mjs run --group core
//   npm run eval:agent      -> node eval/run.mjs run --group agent
//   npm run eval:report     -> node eval/run.mjs report
//
// Flags: --suite --runner --repeat --task --group --split --run

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { loadTasks, validateAll, REQUIRED_FIELDS } from './lib/loader.mjs';
import { runTrial, aggregate, FAILURE_CLASSES } from './lib/engine.mjs';
import { RUNNER_NAMES } from './runners/deterministic.mjs';
import { listPredicates } from './graders/predicates.mjs';
import { canonicalHash } from './environment/snapshot.mjs';
import {
  RESULTS_DIR,
  buildCoverage,
  buildReport,
  listRuns,
  loadRun,
  renderReportMarkdown,
  writeReport,
} from './lib/report.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const evalRoot = here;
const repoRoot = join(here, '..');

const GROUPS = {
  core: ['workflow', 'references', 'provider', 'production-task', 'local-assets'],
  agent: ['agent'],
  environment: ['environment'],
};

const GROUP_RUNNERS = {
  core: ['oracle', 'cli', 'mcp'],
  agent: ['oracle', 'cli', 'mcp', 'codex'],
  environment: ['environment'],
};

const WRITE_COMMANDS = new Set(['workflow.apply', 'workflow.node.run', 'task.resume']);

/** Suites whose captured world carries the host platform, so hashes cannot be froze cross-platform. */
const FREEZE_EXCLUDED_SUITES = new Set(['environment']);

/**
 * Where the private holdout dataset is mounted.
 *
 * It is intentionally not a directory inside the repository: a holdout that
 * ships with the code is not a holdout. A certification run mounts it by path.
 */
function holdoutDirectory(flags) {
  const value = flags.holdout ? String(flags.holdout) : process.env.FLOVARTBENCH_HOLDOUT_DIR;
  return value ? resolve(value) : null;
}

function parseFlags(argv) {
  const flags = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      flags._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i += 1;
    }
  }
  return flags;
}

function asList(value) {
  if (!value) return [];
  if (value === true) return [];
  return String(value).split(',').map(entry => entry.trim()).filter(Boolean);
}

export async function collectEnvironment() {
  const commit = git(['rev-parse', 'HEAD']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const dirty = git(['status', '--porcelain']);
  const fallback = (commit && branch) ? null : await headFromFilesystem();
  const ci = Boolean(process.env.GITHUB_ACTIONS || process.env.CI);
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    ci,
    githubRunnerOs: process.env.RUNNER_OS ?? null,
    githubWorkflow: process.env.GITHUB_WORKFLOW ?? null,
    commit: commit ?? fallback?.commit ?? 'unavailable',
    branch: branch ?? fallback?.branch ?? 'unavailable',
    // `dirty` stays null when git could not answer: "no local changes" and
    // "could not check" are different claims.
    dirty: dirty === null ? null : dirty.trim().length > 0,
    fingerprint: createHash('sha256')
      .update([
        process.version,
        process.platform,
        process.arch,
        process.env.RUNNER_OS ?? 'local',
        ci ? 'ci' : 'local',
      ].join('|'))
      .digest('hex')
      .slice(0, 16),
    capturedAt: new Date().toISOString(),
  };
}

function git(args) {
  try {
    const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) return null;
    return (result.stdout ?? '').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Read HEAD straight out of .git when the git binary is not usable (sandboxes,
 * stripped images, no PATH). A report without a commit is a report nobody can
 * reproduce against.
 */
async function headFromFilesystem() {
  try {
    const gitDir = join(repoRoot, '.git');
    const head = (await readFile(join(gitDir, 'HEAD'), 'utf8')).trim();
    if (!head.startsWith('ref:')) return { commit: head, branch: 'detached' };
    const ref = head.slice(4).trim();
    const branch = ref.replace(/^refs\/heads\//, '');
    try {
      const sha = (await readFile(join(gitDir, ...ref.split('/')), 'utf8')).trim();
      return { commit: sha, branch };
    } catch {
      const packed = await readFile(join(gitDir, 'packed-refs'), 'utf8');
      const line = packed.split(/\r?\n/).find(entry => entry.endsWith(` ${ref}`));
      return { commit: line ? line.split(' ')[0] : null, branch };
    }
  } catch {
    return { commit: null, branch: null };
  }
}

function makeRunId(label) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `${stamp}-${label}`;
}

async function selectTasks(flags) {
  const group = flags.group ? String(flags.group) : null;
  const suites = asList(flags.suite);
  const all = await loadTasks(evalRoot, { holdoutDir: holdoutDirectory(flags) });
  let tasks = all;
  if (group && GROUPS[group]) {
    const allowed = new Set(GROUPS[group]);
    tasks = tasks.filter(task => allowed.has(task.suite));
  }
  if (suites.length) {
    const allowed = new Set(suites);
    tasks = tasks.filter(task => allowed.has(task.suite));
  }
  const taskId = flags.task ? String(flags.task) : null;
  if (taskId) {
    tasks = tasks.filter(task => task.id === taskId || task.id.includes(taskId));
    if (!tasks.length) throw new Error(`No task matches "${taskId}"`);
  }
  const split = flags.split ? String(flags.split) : null;
  if (split) tasks = tasks.filter(task => task.split === split);
  return tasks;
}

async function cmdValidate(flags) {
  const holdoutDir = holdoutDirectory(flags);
  const { tasks, errors, count, holdoutIds } = await validateAll(evalRoot, {
    suite: asList(flags.suite)[0] ?? undefined,
    holdoutDir,
  });

  // grader exists: the predicate registry must be loadable and non-empty
  const predicates = listPredicates();
  if (!predicates.length) errors.push('predicate registry is empty - grader missing');

  // The reviewable schema and the executable validator must agree, otherwise one
  // of them is documentation that lies.
  try {
    const schema = JSON.parse(await readFile(join(evalRoot, 'schema', 'eval-task.schema.json'), 'utf8'));
    const declared = [...(schema.required ?? [])].sort().join(',');
    const enforced = [...REQUIRED_FIELDS].sort().join(',');
    if (declared !== enforced) {
      errors.push(`schema/eval-task.schema.json requires [${declared}] but the loader enforces [${enforced}]`);
    }
  } catch (error) {
    errors.push(`schema/eval-task.schema.json is unreadable: ${error.message}`);
  }

  // fixture exists: every task that drives the workflow must define a fixture project
  for (const task of tasks) {
    if (!task.fixture || typeof task.fixture !== 'object') {
      errors.push(`${task.id}: missing fixture`);
      continue;
    }
    if (task.fixture.project && !Array.isArray(task.fixture.project.nodes)) {
      errors.push(`${task.id}: fixture.project.nodes must be an array`);
    }
  }

  const suites = new Map();
  for (const task of tasks) suites.set(task.suite, (suites.get(task.suite) ?? 0) + 1);

  console.log(`\nFlovartBench validate`);
  console.log(`  tasks: ${count}`);
  for (const [suite, n] of [...suites].sort()) console.log(`    ${suite}: ${n}`);
  console.log(`  predicates: ${predicates.length}`);
  if (holdoutDir) {
    console.log(`  holdout mounted: ${holdoutDir} (${holdoutIds.length} task(s), never committed)`);
  } else {
    console.log('  holdout mounted: none (set FLOVARTBENCH_HOLDOUT_DIR or --holdout <dir>)');
  }

  if (errors.length) {
    console.log(`\n  FAIL: ${errors.length} problem(s)`);
    for (const error of errors) console.log(`    - ${error}`);
    process.exitCode = 1;
    return { ok: false, errors };
  }
  console.log(`\n  PASS: schema valid, fixtures present, graders present, ids unique, no secrets, no dev paths`);
  return { ok: true, errors: [] };
}

/**
 * Oracle / NOP admission gate (E6).
 * Oracle must pass 5/5. NOP must fail every state-mutating task, otherwise the
 * grader is not actually discriminating.
 */
async function cmdOracle(flags) {
  const validation = await cmdValidate(flags);
  if (!validation.ok) {
    process.exitCode = 1;
    return null;
  }

  const tasks = await selectTasks(flags);
  const repeat = Number(flags.repeat ?? 5);
  const runId = makeRunId('oracle');
  const runDir = join(RESULTS_DIR, runId);
  await mkdir(runDir, { recursive: true });

  const startedAt = Date.now();
  const violations = [];
  const entries = [];
  let stableTasks = 0;
  let nopChecked = 0;
  let nopFailedAsExpected = 0;

  const nonDiscriminating = [];
  const knownGaps = [];
  const gapClosed = [];
  const platformSkipped = [];
  const frozen = [];
  const staleHashes = [];
  const freeze = Boolean(flags['freeze-hashes']);
  const holdoutUntouched = [];
  for (const task of tasks) {
    const mutating = requiresAction(task);
    const qaRunner = qaRunnerFor(task);
    const trialResults = [];
    const trialHashes = [];
    for (let i = 1; i <= repeat; i += 1) {
      // In freeze mode the existing hash is deliberately not graded: the point
      // is to re-derive it from a fresh reference run, otherwise a stale value
      // could never be corrected.
      const gradedTask = freeze
        ? { ...task, expected: { ...task.expected, exactCanonical: undefined } }
        : task;
      const { score, worldNormalized } = await runTrial(gradedTask, {
        runnerName: qaRunner,
        runDir,
        metadata: { phase: 'oracle-qa', runId },
        trialIndex: i,
        repeats: repeat,
      });
      trialResults.push(score);
      entries.push(toEntry(score));
      if (worldNormalized) trialHashes.push(canonicalHash(worldNormalized));
    }

    // Repeating the same reference solution must produce the same canonical
    // world. If it does not, either the harness or the product is
    // non-deterministic, and no single trial can be the reference.
    if (trialHashes.length > 1 && new Set(trialHashes).size > 1) {
      violations.push(`${task.id}: ${trialHashes.length} oracle trials produced `
        + `${new Set(trialHashes).size} distinct canonical worlds (non-deterministic)`);
      continue;
    }
    const allPassed = trialResults.every(score => score.success);
    if (allPassed) stableTasks += 1;

    // A task scoped to another platform is neither admissible nor a violation
    // here; it only has to be reported so the coverage gap stays visible.
    if (trialResults.every(score => score.blocked && String(score.blockedReason ?? '').startsWith('PLATFORM_NOT_APPLICABLE'))) {
      platformSkipped.push({ taskId: task.id, reason: trialResults[0].blockedReason });
      continue;
    }

    // A known gap is a task whose premise the product does not implement yet.
    // It is measured and reported, but it cannot block admission: a benchmark
    // that hides its own unimplemented expectations is lying about coverage.
    if (task.knownGap) {
      if (allPassed) gapClosed.push({ taskId: task.id, gap: task.knownGap });
      else {
        knownGaps.push({
          taskId: task.id,
          gap: task.knownGap,
          observed: `${trialResults.filter(s => s.success).length}/${repeat} oracle`,
          failureClass: trialResults.find(s => !s.success)?.failureClass ?? null,
        });
      }
      continue;
    }

    // A frozen hash that no longer matches is dataset maintenance, not a task
    // failure: the reference world changed and the frozen value has to be
    // re-derived. Reported separately so it cannot hide a real regression.
    const stale = trialResults.find(score => score.canonicalHashMatched === false);
    if (stale) {
      staleHashes.push({
        taskId: task.id,
        frozen: stale.canonicalHashExpected,
        actual: stale.canonicalHash,
      });
      continue;
    }

    if (!allPassed) {
      violations.push(`${task.id}: oracle did not pass ${repeat}/${repeat}`
        + ` (${trialResults.filter(s => s.success).length}/${repeat})`
        + ` first failure class=${trialResults.find(s => !s.success)?.failureClass ?? 'none'}`);
    }

    // The environment suite records which platform a probe ran on, so a hash
    // frozen on Windows would be stale on POSIX. Its verdicts are already fully
    // asserted by `runtime.discovery_verdicts`.
    // Holdout tasks are read-only here: their frozen hashes belong to whoever
    // owns the private dataset. A public run must never rewrite them.
    if (freeze && task.__holdout) {
      holdoutUntouched.push(task.id);
      continue;
    }
    if (freeze && allPassed && trialHashes.length && !FREEZE_EXCLUDED_SUITES.has(task.suite)) {
      const hash = trialHashes[0];
      await writeFrozenHash(task, hash);
      frozen.push({ taskId: task.id, hash, previous: task.expected?.exactCanonical ?? null });
    }

    const { score: nopScore } = await runTrial(task, {
      runnerName: 'nop',
      runDir,
      metadata: { phase: 'nop-qa', runId },
      trialIndex: 1,
      repeats: 1,
    });
    entries.push(toEntry(nopScore));
    if (mutating) {
      nopChecked += 1;
      if (!nopScore.success) nopFailedAsExpected += 1;
      else violations.push(`${task.id}: NOP passed on a state-changing task - grader does not discriminate`);
    } else if (nopScore.success) {
      // Observational task: nothing in the world changes, so a no-op runner
      // legitimately satisfies the predicates. Recorded, not hidden.
      nonDiscriminating.push(task.id);
    } else {
      violations.push(`${task.id}: NOP failed on an observational task - predicates may be over-constrained`);
    }
  }

  const qa = {
    tasks: tasks.length,
    repeat,
    // A task whose frozen hash is stale was not actually graded against its
    // reference world, so it is not admissible in this run either.
    admissibleTasks: tasks.length - knownGaps.length - gapClosed.length
      - platformSkipped.length - staleHashes.length,
    stableTasks,
    nopChecked,
    nopFailedAsExpected,
    observationalTasks: tasks.length - nopChecked,
    nonDiscriminating,
    knownGaps,
    gapClosed,
    platformSkipped,
    staleHashes,
    frozen,
    holdoutUntouched,
    violations,
    passed: violations.length === 0,
  };

  const wallTimeMs = Date.now() - startedAt;
  const run = {
    id: runId,
    command: 'oracle',
    runners: ['oracle', 'nop'],
    repeat,
    tasks: tasks.map(task => task.id),
    environment: await collectEnvironment(),
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    wallTimeMs,
    oracleQa: qa,
  };
  await writeFile(join(runDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  await writeFile(join(runDir, 'summary.json'), `${JSON.stringify({
    aggregate: aggregate(entries),
    entries,
  }, null, 2)}\n`, 'utf8');

  console.log(`\nOracle / NOP admission gate`);
  console.log(`  tasks: ${qa.tasks}  repeat: ${repeat}`);
  console.log(`  oracle 5/5 stable: ${qa.stableTasks} / ${qa.tasks} (admissible: ${qa.admissibleTasks})`);
  console.log(`  nop failed as expected: ${qa.nopFailedAsExpected} / ${qa.nopChecked} (observational skipped: ${qa.observationalTasks})`);
  if (nonDiscriminating.length) {
    console.log(`  note: NOP passes these observational tasks by design: ${nonDiscriminating.join(', ')}`);
  }
  console.log(`  wall time: ${wallTimeMs} ms`);
  if (frozen.length) {
    const changed = frozen.filter(entry => entry.previous !== entry.hash);
    console.log(`\n  frozen canonical hashes: ${frozen.length} task(s) written (${changed.length} changed)`);
    for (const entry of changed) {
      console.log(`    ${entry.taskId}: ${entry.previous ?? '(none)'} -> ${entry.hash}`);
    }
  }
  if (staleHashes.length) {
    console.log(`\n  stale canonical hashes (${staleHashes.length} task(s), excluded from admission;`
      + ` re-run with --freeze-hashes after confirming the new world):`);
    for (const entry of staleHashes) {
      console.log(`    ${entry.taskId}: frozen ${entry.frozen} != actual ${entry.actual}`);
    }
  }
  if (knownGaps.length) {
    console.log(`\n  known gaps (measured, excluded from admission):`);
    for (const gap of knownGaps) {
      console.log(`    - ${gap.taskId} [${gap.observed}] class=${gap.failureClass}`);
      console.log(`      ${gap.gap}`);
    }
  }
  if (platformSkipped.length) {
    console.log(`\n  not applicable on this platform (coverage on other runners only):`);
    for (const entry of platformSkipped) console.log(`    - ${entry.taskId} (${entry.reason})`);
  }
  if (gapClosed.length) {
    console.log(`\n  gaps that now pass (update the task's knownGap note):`);
    for (const gap of gapClosed) console.log(`    - ${gap.taskId}`);
  }
  console.log(`  run id: ${runId}`);
  if (violations.length) {
    console.log(`\n  ADMISSION FAIL`);
    for (const violation of violations) console.log(`    - ${violation}`);
    process.exitCode = 1;
  } else {
    console.log(`\n  ADMISSION PASS`);
  }
  return qa;
}

/**
 * Does this task require the agent to actually attempt something?
 *
 * A rejected write still requires an attempt: the task exists to prove the
 * system said no, so a runner that attempts nothing has not solved it.
 * Purely observational tasks (inspect/selection only) are the only ones where
 * NOP is allowed to pass, and those are reported separately.
 */
function requiresAction(task) {
  if (task.expected?.expectsRejection) return true;
  return (task.solution?.steps ?? []).some(
    step => WRITE_COMMANDS.has(step.command) || String(step.command).startsWith('runtime.'),
  );
}

/**
 * The runner that can express a task. Most tasks are expressible on the
 * canonical Agent surface and are validated by the oracle; a task that is only
 * reachable through a narrower seam names its own runner.
 */
function qaRunnerFor(task) {
  return (task.runnerScope ?? ['oracle'])[0];
}

function toEntry(score) {
  return {
    taskId: score.taskId,
    suite: score.suite,
    split: score.split,
    runner: score.runner,
    trialIndex: score.trialIndex,
    success: score.success,
    blocked: score.blocked,
    failureClass: score.failureClass,
    hardGateFailures: score.hardGateFailures,
    rejectionCodes: score.observedRejectionCodes,
    rejectionCodeFailures: score.rejectionCodeFailures,
    predicates: score.predicates,
    predicateAccuracy: score.predicateAccuracy,
    safety: score.safety,
    efficiency: score.efficiency,
    usage: score.usage,
    timing: score.timing,
    gradingMode: score.gradingMode,
    canonicalHash: score.canonicalHash,
    canonicalHashExpected: score.canonicalHashExpected,
    canonicalHashMatched: score.canonicalHashMatched,
    knownGap: score.knownGap,
  };
}

async function cmdRun(flags) {
  const validation = await cmdValidate(flags);
  if (!validation.ok) {
    process.exitCode = 1;
    return null;
  }

  const group = flags.group ? String(flags.group) : null;
  const selected = await selectTasks(flags);
  // Known-gap tasks have premises the product does not implement yet. Scoring
  // them would fold a known non-capability into the capability baseline.
  const gaps = flags['include-gaps'] ? [] : selected.filter(task => task.knownGap);
  const tasks = selected.filter(task => !gaps.includes(task));
  const runners = asList(flags.runner).length
    ? asList(flags.runner)
    : (GROUP_RUNNERS[group] ?? ['oracle']);
  for (const runner of runners) {
    if (!RUNNER_NAMES.includes(runner)) throw new Error(`Unknown runner "${runner}". Known: ${RUNNER_NAMES.join(', ')}`);
  }
  const repeat = Number(flags.repeat ?? 5);

  const runId = makeRunId(group ?? 'custom');
  const runDir = join(RESULTS_DIR, runId);
  await mkdir(runDir, { recursive: true });

  const startedAt = Date.now();
  const entries = [];
  let standInTrials = 0;
  let certifiedTrials = 0;

  console.log(`\nFlovartBench run: ${tasks.length} task(s) x ${runners.length} runner(s) x ${repeat} trial(s)`);
  if (gaps.length) {
    console.log(`  excluded known gaps: ${gaps.map(task => task.id).join(', ')}`);
  }

  const skipped = [];
  for (const runner of runners) {
    for (const task of tasks) {
      // A task that needs an argument no Agent surface exposes cannot be
      // scored on that surface. Skipping is recorded, not silently dropped.
      if (Array.isArray(task.runnerScope) && !task.runnerScope.includes(runner)) {
        skipped.push({ taskId: task.id, runner, reason: task.runnerScopeReason ?? `only runs on ${task.runnerScope.join(', ')}` });
        console.log(`  [skip] ${runner.padEnd(6)} ${task.id.padEnd(42)} not expressible on this surface`);
        continue;
      }
      for (let i = 1; i <= repeat; i += 1) {
        const { score } = await runTrial(task, {
          runnerName: runner,
          runDir,
          metadata: { phase: 'benchmark', runId, group },
          trialIndex: i,
          repeats: repeat,
        });
        entries.push(toEntry(score));
        if (runner === 'codex') {
          if (score.blocked) standInTrials += 1;
          else certifiedTrials += 1;
        }
      }
      const taskEntries = entries.filter(entry => entry.taskId === task.id && entry.runner === runner);
      const passed = taskEntries.filter(entry => entry.success).length;
      const mark = passed === repeat ? 'PASS' : 'FAIL';
      console.log(`  [${mark}] ${runner.padEnd(6)} ${task.id.padEnd(42)} ${passed}/${repeat}`
        + (taskEntries.some(entry => entry.blocked) ? ' (blocked)' : ''));
    }
  }

  const summary = { aggregate: aggregate(entries), entries };
  const wallTimeMs = Date.now() - startedAt;
  const run = {
    id: runId,
    command: 'run',
    group,
    suites: [...new Set(tasks.map(task => task.suite))].sort(),
    runners,
    repeat,
    split: flags.split ? String(flags.split) : 'all',
    tasks: tasks.map(task => task.id),
    excludedKnownGaps: gaps.map(task => task.id),
    skippedForSurface: skipped,
    environment: await collectEnvironment(),
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    wallTimeMs,
    agentStandIn: runners.includes('codex')
      ? { standInTrials, certifiedTrials }
      : null,
  };
  await writeFile(join(runDir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  await writeFile(join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

  const agg = summary.aggregate;
  console.log(`\n  pass@1 : ${(agg.passAt1 * 100).toFixed(1)}% (${agg.successfulTrials}/${agg.trials})`);
  console.log(`  pass^5 : ${(agg.passPow5 * 100).toFixed(1)}% (${agg.stableTasks}/${agg.tasks})`);
  console.log(`  safety : ${agg.hardGatePass ? 'hard gate PASS' : 'hard gate FAIL'} ${JSON.stringify(agg.safety)}`);
  console.log(`  failures: ${JSON.stringify(agg.failureDistribution)}`);
  console.log(`  run id: ${runId}`);

  if (!agg.hardGatePass) process.exitCode = 1;
  return { runId, aggregate: agg };
}

async function cmdReport(flags) {
  const runs = await listRuns();
  if (!runs.length) {
    console.log('No benchmark runs found. Run `npm run eval:core` first.');
    process.exitCode = 1;
    return null;
  }
  const targetId = flags.run ? String(flags.run) : runs[runs.length - 1];
  const { run, summary } = await loadRun(targetId);

  let qa = run.oracleQa ?? null;
  if (!qa) {
    for (const candidate of [...runs].reverse()) {
      try {
        const loaded = await loadRun(candidate);
        if (loaded.run.oracleQa) {
          qa = loaded.run.oracleQa;
          break;
        }
      } catch { /* skip unreadable runs */ }
    }
  }

  // The agent baseline lives in its own run, so merge the most recent one
  // instead of reporting "not included" whenever the latest run was core.
  let agent = null;
  const agentRun = await latestRunWithGroup(runs, 'agent', targetId);
  if (agentRun) {
    agent = {
      ...agentRun.summary.aggregate,
      standInTrials: agentRun.run.agentStandIn?.standInTrials ?? 0,
      certifiedTrials: agentRun.run.agentStandIn?.certifiedTrials ?? 0,
      runId: agentRun.runId,
    };
  }

  let environment = null;
  const environmentRun = await latestRunWithGroup(runs, 'environment', targetId);
  if (environmentRun) {
    environment = { ...environmentRun.summary.aggregate, runId: environmentRun.runId };
  }

  // Coverage is built from the full dataset, not from the executed subset, so a
  // suite that never ran shows up as unexecuted instead of absent.
  const allTasks = await loadTasks(evalRoot, { holdoutDir: holdoutDirectory(flags) });
  const coverage = buildCoverage({
    dataset: { tasks: allTasks, predicateCount: listPredicates().length },
    oracle: qa,
    baselines: { agent },
    runs: { deterministic: summary.aggregate, agent, environment },
  });

  const report = buildReport({ run, summary, qa, coverage, baselines: { agent, environment } });
  const paths = await writeReport(report);
  console.log(`\nReport written:`);
  console.log(`  ${paths.json}`);
  console.log(`  ${paths.markdown}`);
  if (paths.coverage) console.log(`  ${paths.coverage}`);
  console.log(`\n${renderReportMarkdown(report)}`);
  return report;
}

/**
 * Write a frozen canonical hash into the task file, textually.
 * A JSON round-trip would reformat the whole file, turning a one-line change
 * into an unreviewable diff.
 */
async function writeFrozenHash(task, hash) {
  if (!task.__path) throw new Error(`${task.id}: no source path, cannot freeze a hash`);
  const text = await readFile(task.__path, 'utf8');
  const idIndex = text.indexOf(`"id": "${task.id}"`);
  if (idIndex < 0) throw new Error(`${task.id}: not found in ${task.__path}`);
  const expectedIndex = text.indexOf('"expected": {', idIndex);
  if (expectedIndex < 0) throw new Error(`${task.id}: no expected block in ${task.__path}`);
  const braceLineEnd = text.indexOf('\n', expectedIndex) + 1;
  const childIndent = (text.slice(braceLineEnd).match(/^\s*/) ?? [''])[0];

  // Replace an existing frozen hash, otherwise insert one on its own line.
  const existing = /^\s*"exactCanonical":\s*"[^"]*",?\n/m;
  const window = text.slice(braceLineEnd, text.indexOf('"solution"', braceLineEnd));
  if (existing.test(window)) {
    const updated = text.slice(0, braceLineEnd)
      + window.replace(existing, `${childIndent}"exactCanonical": "${hash}",\n`)
      + text.slice(text.indexOf('"solution"', braceLineEnd));
    await writeFile(task.__path, updated, 'utf8');
    return;
  }
  const updated = text.slice(0, braceLineEnd)
    + `${childIndent}"exactCanonical": "${hash}",\n`
    + text.slice(braceLineEnd);
  await writeFile(task.__path, updated, 'utf8');
}

async function latestRunWithGroup(runs, group, excludeId) {
  for (const candidate of [...runs].reverse()) {
    if (candidate === excludeId) continue;
    try {
      const loaded = await loadRun(candidate);
      if (loaded.run.group === group && loaded.summary) return loaded;
    } catch { /* unreadable run, keep looking */ }
  }
  return null;
}

function printUsage() {
  console.log(`FlovartBench

  node eval/run.mjs validate [--suite NAME]
  node eval/run.mjs oracle   [--suite NAME] [--task ID] [--repeat N]
  node eval/run.mjs run      [--group core|agent] [--suite NAME] [--runner a,b] [--repeat N] [--task ID] [--split dev|regression]
  node eval/run.mjs report   [--run RUN_ID]

  runners: ${RUNNER_NAMES.join(', ')}
  failure classes: ${FAILURE_CLASSES.join(', ')}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  switch (command) {
    case 'validate': await cmdValidate(flags); break;
    case 'oracle': await cmdOracle(flags); break;
    case 'run': await cmdRun(flags); break;
    case 'report': await cmdReport(flags); break;
    case undefined: printUsage(); break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(`\nFlovartBench error: ${error.message}`);
  if (process.env.FLOVARTBENCH_DEBUG === 'true') console.error(error.stack);
  process.exitCode = 1;
});
