// Two-run convergence comparison.
//
// Compares failure hits between two benchmark runs keyed by
// (taskId, failed predicate, failedLayer). Blocked trials never enter a
// denominator, and a key whose task executed zero trials on one side is
// reported as unobserved instead of converged/new, so a smaller sample can
// never masquerade as a fix. Runs recorded before layer attribution existed
// carry no failedLayer; those failures are bucketed as UNATTRIBUTED and are
// never inferred.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { listRuns, loadRun, REPORTS_DIR } from './report.mjs';

export const UNATTRIBUTED = 'UNATTRIBUTED';
export const NO_FAILED_PREDICATE = '(no failed predicate)';

function predicateName(failure) {
  return typeof failure === 'string' ? failure : String(failure?.name ?? failure);
}

function gateName(gate) {
  return typeof gate === 'string' ? gate : String(gate?.name ?? gate?.gate ?? gate);
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

function tally(entries) {
  const failures = new Map();
  const failureClasses = {};
  const hardGates = {};
  const executedByTask = {};
  let executed = 0;
  let blocked = 0;
  let failedTrials = 0;
  for (const entry of entries) {
    if (entry.blocked) {
      blocked += 1;
      continue;
    }
    executed += 1;
    increment(executedByTask, entry.taskId);
    if (entry.failureClass) increment(failureClasses, entry.failureClass);
    for (const gate of entry.hardGateFailures ?? []) increment(hardGates, gateName(gate));
    if (entry.success) continue;
    failedTrials += 1;
    const layer = typeof entry.failedLayer === 'string' && entry.failedLayer ? entry.failedLayer : UNATTRIBUTED;
    const names = (entry.predicates?.failed ?? []).map(predicateName);
    for (const predicate of names.length ? names : [NO_FAILED_PREDICATE]) {
      const key = JSON.stringify([entry.taskId, predicate, layer]);
      const record = failures.get(key) ?? { taskId: entry.taskId, predicate, failedLayer: layer, count: 0 };
      record.count += 1;
      failures.set(key, record);
    }
  }
  return { executed, blocked, failedTrials, failures, failureClasses, hardGates, executedByTask };
}

function statusOf(a, b, executedA, executedB) {
  if (!executedA || !executedB) return 'unobserved';
  if (a === b) return 'unchanged';
  if (a === 0) return 'new';
  if (b === 0) return 'converged';
  return b < a ? 'partial' : 'regressed';
}

function rate(count, executed) {
  return executed ? count / executed : null;
}

function diffCounts(a, b) {
  const names = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return names.map(name => {
    const countA = a[name] ?? 0;
    const countB = b[name] ?? 0;
    return { name, a: countA, b: countB, delta: countB - countA };
  });
}

// Pure comparison of two loaded summaries.
export function compareSummaries({ runA, runB, entriesA, entriesB }) {
  const a = tally(entriesA);
  const b = tally(entriesB);
  const keys = [...new Set([...a.failures.keys(), ...b.failures.keys()])];
  const failures = keys.map(key => {
    const base = a.failures.get(key) ?? b.failures.get(key);
    const countA = a.failures.get(key)?.count ?? 0;
    const countB = b.failures.get(key)?.count ?? 0;
    const executedA = a.executedByTask[base.taskId] ?? 0;
    const executedB = b.executedByTask[base.taskId] ?? 0;
    return {
      taskId: base.taskId,
      predicate: base.predicate,
      failedLayer: base.failedLayer,
      a: countA,
      b: countB,
      delta: countB - countA,
      executedA,
      executedB,
      rateA: rate(countA, executedA),
      rateB: rate(countB, executedB),
      status: statusOf(countA, countB, executedA, executedB),
    };
  }).sort((x, y) => x.taskId.localeCompare(y.taskId)
    || x.predicate.localeCompare(y.predicate)
    || x.failedLayer.localeCompare(y.failedLayer));

  const statusCounts = {};
  for (const row of failures) increment(statusCounts, row.status);

  return {
    schemaVersion: 1,
    runA,
    runB,
    trials: {
      a: { total: entriesA.length, executed: a.executed, blocked: a.blocked, failed: a.failedTrials },
      b: { total: entriesB.length, executed: b.executed, blocked: b.blocked, failed: b.failedTrials },
      sampleMismatch: a.executed !== b.executed,
    },
    statusCounts,
    failures,
    failureClassDelta: diffCounts(a.failureClasses, b.failureClasses),
    hardGateFailureDelta: diffCounts(a.hardGates, b.hardGates),
  };
}

function pct(value) {
  return value === null ? 'n/a' : (value * 100).toFixed(1) + '%';
}

function signed(value) {
  return value > 0 ? '+' + value : String(value);
}

function row(cells) {
  return '| ' + cells.join(' | ') + ' |';
}

function describeRun(label, id, trials) {
  return '- ' + label + ': ' + id + ' - executed ' + trials.executed
    + ' (blocked ' + trials.blocked + ', failed ' + trials.failed + ', total ' + trials.total + ')';
}

export function renderCompareMarkdown(result) {
  const { a, b } = result.trials;
  const lines = [];
  lines.push('# FlovartBench Run Comparison');
  lines.push('');
  lines.push(describeRun('A', result.runA, a));
  lines.push(describeRun('B', result.runB, b));
  lines.push('- Denominators count non-blocked trials only.');
  if (result.trials.sampleMismatch) {
    lines.push('- WARNING: executed trial counts differ (' + a.executed + ' vs ' + b.executed + '); compare rates, not raw counts.');
  }
  lines.push('');
  lines.push('## Failure hits by (task, predicate, layer)');
  lines.push('');
  if (!result.failures.length) {
    lines.push('No failing non-blocked trials in either run.');
  } else {
    const summary = Object.entries(result.statusCounts).map(([name, count]) => name + ' ' + count).join(', ');
    lines.push('Status: ' + summary);
    lines.push('');
    lines.push(row(['Task', 'Predicate', 'Layer', 'A', 'B', 'Delta', 'Rate A', 'Rate B', 'Status']));
    lines.push(row(['---', '---', '---', '---:', '---:', '---:', '---:', '---:', '---']));
    for (const entry of result.failures) {
      lines.push(row([
        entry.taskId,
        entry.predicate,
        entry.failedLayer,
        entry.a,
        entry.b,
        signed(entry.delta),
        pct(entry.rateA) + ' (n=' + entry.executedA + ')',
        pct(entry.rateB) + ' (n=' + entry.executedB + ')',
        entry.status,
      ]));
    }
  }
  const sections = [
    ['Failure class delta', result.failureClassDelta],
    ['Hard gate failure delta', result.hardGateFailureDelta],
  ];
  for (const [title, rows] of sections) {
    lines.push('');
    lines.push('## ' + title);
    lines.push('');
    if (!rows.length) {
      lines.push('None in either run.');
      continue;
    }
    lines.push(row(['Name', 'A', 'B', 'Delta']));
    lines.push(row(['---', '---:', '---:', '---:']));
    for (const entry of rows) lines.push(row([entry.name, entry.a, entry.b, signed(entry.delta)]));
  }
  lines.push('');
  return lines.join('\n');
}

// node eval/run.mjs report --compare RUN_A RUN_B
export async function cmdCompare(flags) {
  const runA = flags.compare === true || flags.compare === undefined ? null : String(flags.compare);
  const runB = flags._?.[0] ? String(flags._[0]) : null;
  if (!runA || !runB || flags._.length > 1) {
    console.error('Usage: node eval/run.mjs report --compare RUN_A RUN_B');
    process.exitCode = 1;
    return null;
  }
  const runs = await listRuns();
  const missing = [runA, runB].filter(id => !runs.includes(id));
  if (missing.length) {
    const recent = runs.slice(-5);
    console.error('Unknown run id: ' + missing.join(', ') + ' (not a directory under eval/results).');
    console.error('Most recent runs: ' + (recent.length ? recent.join(', ') : '(none)'));
    process.exitCode = 1;
    return null;
  }
  const [loadedA, loadedB] = await Promise.all([loadRun(runA), loadRun(runB)]);
  for (const loaded of [loadedA, loadedB]) {
    if (!Array.isArray(loaded.summary?.entries)) {
      console.error('Run ' + loaded.runId + ' has no summary.json entries to compare.');
      process.exitCode = 1;
      return null;
    }
  }
  const result = compareSummaries({
    runA,
    runB,
    entriesA: loadedA.summary.entries,
    entriesB: loadedB.summary.entries,
  });
  const markdown = renderCompareMarkdown(result);
  const outDir = join(REPORTS_DIR, 'compare-' + runA + '__' + runB);
  await mkdir(outDir, { recursive: true });
  const jsonPath = join(outDir, 'compare.json');
  const markdownPath = join(outDir, 'compare.md');
  await writeFile(jsonPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  await writeFile(markdownPath, markdown, 'utf8');
  console.log('\nComparison written:');
  console.log('  ' + jsonPath);
  console.log('  ' + markdownPath);
  console.log('\n' + markdown);
  return result;
}
