// Benchmark report generation.
//
// This file is the only place allowed to turn run data into a report. Every
// number it prints came out of eval/results. Nothing here is hand-tuned: if a
// number looks bad, the fix belongs in the product or the harness, not here.

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FAILURE_CLASSES } from './engine.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const evalRoot = join(here, '..');
export const repoRoot = join(evalRoot, '..');

export const RESULTS_DIR = join(evalRoot, 'results');
export const REPORTS_DIR = join(evalRoot, 'reports');

export async function listRuns() {
  let entries = [];
  try {
    entries = await readdir(RESULTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
}

export async function loadRun(runId) {
  const runDir = join(RESULTS_DIR, runId);
  const run = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8'));
  let summary = null;
  try {
    summary = JSON.parse(await readFile(join(runDir, 'summary.json'), 'utf8'));
  } catch {
    summary = null;
  }
  return { runId, runDir, run, summary };
}

/**
 * Build the machine-readable report. Sections follow the GOAL's final report
 * format so the Markdown is a projection of this object and never the reverse.
 */
export function buildReport({ run, summary, qa, coverage, baselines }) {
  const aggregate = summary?.aggregate ?? null;
  const entries = summary?.entries ?? [];
  const tasks = run.tasks ?? [];
  const bySuite = {};
  for (const entry of entries) {
    bySuite[entry.suite] ??= { tasks: new Set(), trials: 0, success: 0 };
    bySuite[entry.suite].tasks.add(entry.taskId);
    bySuite[entry.suite].trials += 1;
    if (entry.success) bySuite[entry.suite].success += 1;
  }
  const dataset = Object.entries(bySuite).map(([suite, value]) => ({
    suite,
    tasks: value.tasks.size,
    trials: value.trials,
    passAt1: value.trials ? value.success / value.trials : 0,
  }));

  const splits = {};
  for (const entry of entries) {
    const key = entry.split ?? 'unspecified';
    splits[key] ??= new Set();
    splits[key].add(entry.taskId);
  }
  const splitSummary = Object.fromEntries(
    Object.entries(splits).map(([key, ids]) => [key, ids.size]),
  );

  const failures = {};
  for (const name of FAILURE_CLASSES) failures[name] = 0;
  for (const entry of entries) {
    if (entry.failureClass) failures[entry.failureClass] += 1;
  }

  const productBugs = entries
    .filter(entry => entry.failureClass === 'PRODUCT_FAILURE' || entry.hardGateFailures?.length)
    .map(entry => ({
      taskId: entry.taskId,
      suite: entry.suite,
      runner: entry.runner,
      trialIndex: entry.trialIndex,
      failureClass: entry.failureClass,
      hardGateFailures: entry.hardGateFailures ?? [],
      failedPredicates: entry.predicates?.failed ?? [],
      error: entry.error ?? null,
    }));

  return {
    schemaVersion: '0.1.0',
    generatedAt: new Date().toISOString(),
    commit: run.environment?.commit ?? 'unavailable',
    branch: run.environment?.branch ?? 'unavailable',
    dirty: run.environment?.dirty ?? null,
    environment: run.environment ?? {},
    run: {
      id: run.id,
      command: run.command,
      group: run.group ?? null,
      suites: run.suites ?? [],
      runners: run.runners ?? [],
      repeat: run.repeat ?? 1,
      split: run.split ?? 'dev',
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      wallTimeMs: run.wallTimeMs ?? null,
    },
    tasks: {
      requested: tasks.length,
      executed: new Set(entries.map(entry => entry.taskId)).size,
      ids: [...new Set(entries.map(entry => entry.taskId))].sort(),
    },
    trials: {
      total: entries.length,
      successful: entries.filter(entry => entry.success).length,
      blocked: entries.filter(entry => entry.blocked).length,
    },
    harness: {
      entry: 'eval/run.mjs',
      world: 'eval/environment/controlled-world.mjs',
      snapshot: 'eval/environment/snapshot.mjs',
      grader: 'eval/graders/predicates.mjs',
      recorder: 'eval/recorders/trajectory.mjs',
      runners: run.runners ?? [],
      gradersAreOutcomeOnly: true,
      trajectoryIsNotScored: true,
    },
    dataset,
    splits: splitSummary,
    coverage: coverage ?? null,
    grading: {
      predicatesOnly: entries.filter(entry => entry.gradingMode === 'predicates').length,
      predicatesPlusExact: entries.filter(entry => entry.gradingMode === 'predicates+exact').length,
      tasksWithFrozenHash: new Set(
        entries.filter(entry => entry.canonicalHashExpected).map(entry => entry.taskId),
      ).size,
    },
    oracleQa: qa ?? null,
    deterministicBaseline: aggregate,
    safety: {
      hardGatePass: aggregate?.hardGatePass ?? null,
      totals: aggregate?.safety ?? null,
      violations: entries
        .filter(entry => (entry.hardGateFailures ?? []).length > 0)
        .map(entry => ({ taskId: entry.taskId, failures: entry.hardGateFailures })),
    },
    agentBaseline: baselines?.agent ?? null,
    environmentBaseline: baselines?.environment ?? null,
    efficiency: aggregate?.efficiency ?? null,
    failureAnalysis: {
      distribution: failures,
      byTask: groupFailuresByTask(entries),
    },
    productBugs,
    hostedCi: run.hostedCi ?? null,
    remainingExternalGates: run.remainingExternalGates ?? defaultExternalGates(),
    reproduce: {
      validate: 'npm run eval:validate',
      oracle: 'npm run eval:oracle',
      core: 'npm run eval:core',
      agent: 'npm run eval:agent',
      report: 'npm run eval:report',
      thisRun: `node eval/run.mjs ${run.command ?? 'run'}${run.group ? ` --group ${run.group}` : ''}`
        + `${(run.runners ?? []).map(runner => ` --runner ${runner}`).join('')}`
        + ` --repeat ${run.repeat ?? 1}`,
    },
  };
}

function groupFailuresByTask(entries) {
  const byTask = new Map();
  for (const entry of entries) {
    if (entry.success) continue;
    if (!byTask.has(entry.taskId)) {
      byTask.set(entry.taskId, { taskId: entry.taskId, suite: entry.suite, failures: 0, classes: {} });
    }
    const record = byTask.get(entry.taskId);
    record.failures += 1;
    const name = entry.failureClass ?? 'UNKNOWN';
    record.classes[name] = (record.classes[name] ?? 0) + 1;
  }
  return [...byTask.values()];
}

function defaultExternalGates() {
  return [
    { gate: 'real Codex agent run', status: 'not-run', reason: 'requires FLOVARTBENCH_ALLOW_CODEX=true and a codex binary' },
    { gate: 'real paid Provider submission', status: 'not-run', reason: 'requires funded provider credentials' },
    { gate: 'host installer / auto-update', status: 'not-run', reason: 'requires a signed build' },
    { gate: 'real account login', status: 'not-run', reason: 'requires hosted account credentials' },
  ];
}

export function renderReportMarkdown(report) {
  const pct = value => (value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(1)}%`);
  const lines = [];
  lines.push('# FlovartBench Report');
  lines.push('');
  lines.push(`- Run id: \`${report.run.id}\``);
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Commit: \`${report.commit}\`${report.dirty ? ' (working tree dirty)' : ''}`);
  lines.push('');

  lines.push('## Environment');
  const env = report.environment ?? {};
  lines.push(`- Node ${env.node ?? '?'} / ${env.platform ?? '?'} ${env.arch ?? '?'}`);
  lines.push(`- CI: ${env.ci ? `yes (${env.githubRunnerOs ?? 'runner'})` : 'no (local)'}`);
  lines.push(`- Fingerprint: \`${env.fingerprint ?? 'n/a'}\``);
  lines.push('');

  lines.push('## Tasks & Trials');
  lines.push(`- Tasks executed: ${report.tasks.executed} / ${report.tasks.requested}`);
  lines.push(`- Trials: ${report.trials.total} (successful ${report.trials.successful}, blocked ${report.trials.blocked})`);
  lines.push(`- Repeat per task: ${report.run.repeat}`);
  lines.push('');

  lines.push('## Dataset');
  lines.push('| Suite | Tasks | Trials | pass@1 |');
  lines.push('| --- | --- | --- | --- |');
  for (const entry of report.dataset) {
    lines.push(`| ${entry.suite} | ${entry.tasks} | ${entry.trials} | ${pct(entry.passAt1)} |`);
  }
  if (report.splits && Object.keys(report.splits).length) {
    const parts = Object.entries(report.splits).map(([name, count]) => `${name}: ${count} task(s)`);
    lines.push('');
    lines.push(`- Split coverage in this run: ${parts.join(', ')}`);
    if (!report.splits.holdout) {
      lines.push('- Holdout is not committed to this repository and was not part of this run,'
        + ' so these numbers say nothing about generalisation.');
    }
  }
  lines.push('');

  lines.push('## Grading');
  lines.push(`- Predicate grading: always on (${report.grading.predicatesOnly + report.grading.predicatesPlusExact} trial(s))`);
  lines.push(`- Tasks with a frozen canonical hash: ${report.grading.tasksWithFrozenHash}`
    + ` (${report.grading.predicatesPlusExact} trial(s) also graded on whole-world equality)`);
  lines.push('- Holdout tasks are not committed to this repository and are not graded here.');
  lines.push('');

  lines.push('## Oracle QA');
  if (!report.oracleQa) {
    lines.push('- Not included in this run. Use `npm run eval:oracle`.');
  } else {
    const qa = report.oracleQa;
    lines.push(`- Tasks checked: ${qa.tasks}`);
    lines.push(`- Oracle 5/5 stable: ${qa.stableTasks} / ${qa.tasks}`);
    lines.push(`- NOP correctly failed: ${qa.nopFailedAsExpected} / ${qa.nopChecked}`);
    lines.push(`- Admission: ${qa.passed ? 'PASS' : 'FAIL'}`);
    if (qa.violations.length) {
      lines.push('');
      lines.push('Violations:');
      for (const violation of qa.violations) lines.push(`- ${violation}`);
    }
  }
  lines.push('');

  lines.push('## Deterministic Baseline');
  const baseline = report.deterministicBaseline;
  if (!baseline) {
    lines.push('- No aggregate in this run.');
  } else {
    lines.push(`- pass@1: ${pct(baseline.passAt1)} (${baseline.successfulTrials}/${baseline.trials})`);
    lines.push(`- pass^5: ${pct(baseline.passPow5)} (${baseline.stableTasks}/${baseline.tasks})`);
    lines.push(`- Final-state accuracy (mean predicate pass rate): ${pct(baseline.finalStateAccuracy)}`);
    lines.push(`- Blocked trials: ${baseline.blockedTrials}`);
  }
  lines.push('');

  lines.push('## Safety');
  const safety = report.safety;
  lines.push(`- Hard gate: ${safety.hardGatePass === null ? 'n/a' : safety.hardGatePass ? 'PASS' : 'FAIL'}`);
  if (safety.totals) {
    lines.push('');
    lines.push('| Counter | Value |');
    lines.push('| --- | --- |');
    for (const [key, value] of Object.entries(safety.totals)) lines.push(`| ${key} | ${value} |`);
  }
  if (safety.violations.length) {
    lines.push('');
    lines.push('Violating trials:');
    for (const violation of safety.violations) {
      lines.push(`- ${violation.taskId}: ${violation.failures.join(', ')}`);
    }
  }
  lines.push('');

  lines.push('## Agent Baseline');
  if (!report.agentBaseline) {
    lines.push('- Not included in this run. Use `npm run eval:agent`.');
  } else {
    const agent = report.agentBaseline;
    lines.push(`- pass@1: ${pct(agent.passAt1)}`);
    lines.push(`- pass^5: ${pct(agent.passPow5)}`);
    lines.push(`- Certified external agent runs: ${agent.certifiedTrials} / ${agent.trials}`);
    if (agent.standInTrials) {
      lines.push(`- Stand-in (non-certified) trials: ${agent.standInTrials} - these do not count as agent results.`);
    }
    if (agent.failureDistribution) {
      const nonZero = Object.entries(agent.failureDistribution).filter(([, count]) => count > 0);
      lines.push(`- Agent-run failures: ${nonZero.length ? nonZero.map(([name, count]) => `${name}=${count}`).join(', ') : 'none'}`);
    }
  }
  lines.push('');

  lines.push('## Environment Transfer');
  if (!report.environmentBaseline) {
    lines.push('- Not included in this run. Use `node eval/run.mjs run --group environment`.');
  } else {
    const env = report.environmentBaseline;
    lines.push(`- pass@1: ${pct(env.passAt1)} (${env.successfulTrials}/${env.executedTrials} executed)`);
    lines.push(`- pass^5: ${pct(env.passPow5)} (${env.stableTasks}/${env.scoredTasks})`);
    if (env.blockedTrials) lines.push(`- Excluded as not applicable on this platform: ${env.blockedTrials} trial(s)`);
  }
  lines.push('');

  lines.push('## Efficiency');
  const efficiency = report.efficiency;
  if (efficiency) {
    lines.push(`- Tool calls per success: ${efficiency.toolCallsPerSuccess?.toFixed(2) ?? 'n/a'}`);
    lines.push(`- Wall time per success: ${efficiency.wallTimePerSuccessMs?.toFixed(1) ?? 'n/a'} ms`);
    if (!efficiency.usageMeasuredTrials) {
      lines.push(`- Tokens / cost: not measured - none of the ${efficiency.reportableUsageTrials ?? 0} executed trial(s) reported usage.`
        + ' Only an external agent runner can report tokens; a deterministic runner makes no model call.');
    } else {
      lines.push(`- Tokens per success: ${efficiency.tokensPerSuccess?.toFixed(1) ?? 'n/a'}`
        + ` (prompt ${efficiency.promptTokensTotal}, completion ${efficiency.completionTokensTotal})`);
      lines.push(`- Cost per success: ${efficiency.costPerSuccessUsd === null ? 'not measured' : `$${efficiency.costPerSuccessUsd.toFixed(6)}`}`
        + ` (total $${efficiency.costUsdTotal?.toFixed(6) ?? 'n/a'})`);
      lines.push(`- Usage measured on ${efficiency.usageMeasuredTrials} / ${efficiency.reportableUsageTrials} executed trial(s)`);
    }
  } else {
    lines.push('- n/a');
  }
  lines.push('');

  lines.push('## Failure Analysis');
  lines.push('| Class | Count |');
  lines.push('| --- | --- |');
  for (const [name, count] of Object.entries(report.failureAnalysis.distribution)) {
    lines.push(`| ${name} | ${count} |`);
  }
  if (report.failureAnalysis.byTask.length) {
    lines.push('');
    lines.push('Failing tasks:');
    for (const entry of report.failureAnalysis.byTask) {
      lines.push(`- ${entry.taskId} (${entry.suite}): ${entry.failures} failing trial(s) ${JSON.stringify(entry.classes)}`);
    }
  }
  lines.push('');

  lines.push('## Product Bugs (suspected)');
  if (!report.productBugs.length) {
    lines.push('- None detected in this run.');
  } else {
    for (const bug of report.productBugs) {
      lines.push(`- \`${bug.taskId}\` [${bug.suite}/${bug.runner} trial ${bug.trialIndex}]`
        + `${bug.hardGateFailures.length ? ` hard-gate: ${bug.hardGateFailures.join(', ')}` : ''}`
        + `${bug.failedPredicates.length ? ` predicates: ${bug.failedPredicates.map(f => f.name).join(', ')}` : ''}`);
    }
  }
  lines.push('');

  lines.push('## Hosted CI');
  lines.push(report.hostedCi ? `- ${report.hostedCi.status}: ${report.hostedCi.note}` : '- Not recorded in this run.');
  lines.push('');

  lines.push('## Remaining External Gates');
  for (const gate of report.remainingExternalGates) {
    lines.push(`- ${gate.gate}: ${gate.status} - ${gate.reason}`);
  }
  lines.push('');

  lines.push('## Reproduce');
  lines.push('```bash');
  lines.push(report.reproduce.validate);
  lines.push(report.reproduce.oracle);
  lines.push(report.reproduce.core);
  lines.push(report.reproduce.agent);
  lines.push(report.reproduce.report);
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

/**
 * Coverage is the file every other number must be read against.
 *
 * The failure mode it exists to prevent is a headline "100% PASS" over a run
 * where a suite, a runner or the holdout set never executed. Every denominator
 * is written down explicitly, including the ones that are zero.
 */
export function buildCoverage({ dataset, oracle, baselines, runs }) {
  const bySplit = split => dataset.tasks.filter(task => task.split === split).length;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tasks: {
      total: dataset.tasks.length,
      dev: bySplit('dev'),
      regression: bySplit('regression'),
      holdoutLoaded: bySplit('holdout'),
      knownGaps: dataset.tasks.filter(task => task.knownGap).length,
      platformScoped: dataset.tasks.filter(task => Array.isArray(task.platforms) && task.platforms.length).length,
      runnerScoped: dataset.tasks.filter(task => Array.isArray(task.runnerScope) && task.runnerScope.length).length,
      bySuite: dataset.tasks.reduce((acc, task) => {
        acc[task.suite] = (acc[task.suite] ?? 0) + 1;
        return acc;
      }, {}),
    },
    graders: {
      predicateAvailable: dataset.predicateCount,
      predicateAlwaysOn: true,
      exactCanonical: dataset.tasks.filter(task => task.expected?.exactCanonical).length,
      rejectionCodes: dataset.tasks.filter(task => Array.isArray(task.expected?.rejectionCodes)).length,
    },
    oracle: {
      eligible: oracle?.admissibleTasks ?? null,
      repeat: oracle?.repeat ?? null,
      passed: oracle?.stableTasks ?? null,
      nopChecked: oracle?.nopChecked ?? null,
      nopFailedAsExpected: oracle?.nopFailedAsExpected ?? null,
      staleHashes: oracle?.staleHashes?.length ?? null,
      platformSkipped: oracle?.platformSkipped?.length ?? null,
    },
    deterministic: runs.deterministic
      ? {
        runners: runs.deterministic.runners,
        tasks: runs.deterministic.tasks,
        executedTrials: runs.deterministic.executedTrials,
        blockedTrials: runs.deterministic.blockedTrials,
        passAt1: runs.deterministic.passAt1,
        passPow5: runs.deterministic.passPow5,
      }
      : null,
    environment: runs.environment
      ? {
        executedTrials: runs.environment.executedTrials,
        notApplicableTrials: runs.environment.blockedTrials,
        passAt1: runs.environment.passAt1,
        passPow5: runs.environment.passPow5,
      }
      : null,
    agent: {
      eligibleTasks: runs.agent?.tasks ?? 0,
      plannedTrials: runs.agent?.trials ?? 0,
      executedTrials: runs.agent?.executedTrials ?? 0,
      blockedTrials: runs.agent?.blockedTrials ?? 0,
      certifiedTrials: baselines?.agent?.certifiedTrials ?? 0,
      standInTrials: baselines?.agent?.standInTrials ?? 0,
    },
    usage: {
      measuredTrials: runs.deterministic?.usageMeasuredTrials ?? 0,
      reportableTrials: runs.deterministic?.reportableUsageTrials ?? 0,
      tokens: runs.deterministic?.promptTokensTotal === null ? 'not-measured' : 'measured',
      cost: runs.deterministic?.costUsdTotal === null ? 'not-measured' : 'measured',
    },
  };
}

export async function writeReport(report) {
  const outDir = join(REPORTS_DIR, report.run.id);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(join(outDir, 'report.md'), renderReportMarkdown(report), 'utf8');
  const paths = { outDir, json: join(outDir, 'report.json'), markdown: join(outDir, 'report.md') };
  if (report.coverage) {
    paths.coverage = join(outDir, 'coverage.json');
    await writeFile(paths.coverage, `${JSON.stringify(report.coverage, null, 2)}\n`, 'utf8');
  }
  return paths;
}
