// Objective-track grading with a grader stability check.
//
// Every applicable grader runs `repeats` times on the same take. If any run
// disagrees (verdict or value), the grader is unstable on that item and the
// item is WITHDRAWN: it leaves every rate's denominator and is listed with its
// reason, instead of being counted as a pass or a fail. A flaky measurement is
// a property of the grader, not of the model.

import { GRADERS, graderKey } from '../graders/index.mjs';

const fingerprint = result => JSON.stringify([result.verdict, result.value ?? null]);

function runOnce(grader, item, take, ctx) {
  try {
    const result = grader.run(item, take, ctx);
    return { verdict: result.verdict, value: result.value ?? null, detail: result.detail ?? '' };
  } catch (error) {
    return { verdict: 'error', value: null, detail: `grader threw: ${error.message}` };
  }
}

/** Run one grader `repeats` times. Returns the first result plus stability. */
export function runStable(grader, item, take, ctx, repeats = 3) {
  const runs = [];
  for (let index = 0; index < Math.max(1, repeats); index += 1) runs.push(runOnce(grader, item, take, ctx));
  const distinct = new Set(runs.map(fingerprint));
  return { grader: grader.id, graderVersion: grader.version, ...runs[0], stable: distinct.size === 1, repeats: runs.length, variants: distinct.size };
}

/** Item-level objective verdict from grader results: any fail → fail; else any error → error; else pass. */
export function objectiveVerdict(results) {
  const counted = results.filter(result => result.verdict !== 'na');
  if (counted.some(result => result.verdict === 'fail')) return 'fail';
  if (counted.some(result => result.verdict === 'error')) return 'error';
  return 'pass';
}

/** Evaluate the item's `rule` checks against grader results (parent-gated). */
export function ruleChecks(item, results) {
  const byGrader = new Map(results.map(result => [result.grader, result]));
  const out = {};
  for (const check of item.checks ?? []) {
    if (check.type !== 'rule') continue;
    const result = byGrader.get(check.grader);
    let verdict = !result ? 'na' : result.verdict;
    if (check.parent && out[check.parent] && out[check.parent] !== 'pass' && out[check.parent] !== 'na') verdict = 'fail';
    out[check.id] = verdict;
  }
  return out;
}

/**
 * Grade one take. Returns
 * { itemId, takeId, results[], verdict, withdrawn: null | { reason }, checks }.
 */
export function gradeTake(item, take, ctx = {}, { repeats = 3, graders = GRADERS } = {}) {
  const results = graders.filter(grader => grader.applies(item, take)).map(grader => runStable(grader, item, take, ctx, repeats));
  const unstable = results.filter(result => !result.stable).map(result => result.grader);
  return {
    itemId: item.id,
    takeId: take.takeId,
    graders: graders.filter(grader => grader.applies(item, take)).map(graderKey),
    results,
    verdict: unstable.length ? 'withdrawn' : objectiveVerdict(results),
    withdrawn: unstable.length ? { reason: `grader-unstable:${unstable.join(',')}` } : null,
    checks: ruleChecks(item, results),
  };
}

/**
 * Grade every take whose item is active. An item is withdrawn as a whole when
 * any of its takes had an unstable grader, so its other takes stop counting too.
 */
export function gradeAll(items, takes, ctx = {}, options = {}) {
  const byId = new Map(items.map(item => [item.id, item]));
  const grades = [];
  const skipped = [];
  for (const take of takes) {
    const item = byId.get(take.itemId);
    if (!item) { skipped.push({ takeId: take.takeId, reason: 'unknown item' }); continue; }
    if ((item.status ?? 'active') !== 'active') { skipped.push({ takeId: take.takeId, reason: `item ${item.status}: ${item.statusReason ?? ''}`.trim() }); continue; }
    grades.push(gradeTake(item, take, ctx, options));
  }
  const withdrawals = new Map();
  for (const grade of grades) if (grade.withdrawn && !withdrawals.has(grade.itemId)) withdrawals.set(grade.itemId, { itemId: grade.itemId, reason: grade.withdrawn.reason, takeId: grade.takeId });
  for (const grade of grades) {
    if (withdrawals.has(grade.itemId) && !grade.withdrawn) {
      grade.withdrawn = { reason: `item-withdrawn:${withdrawals.get(grade.itemId).reason}` };
      grade.verdict = 'withdrawn';
    }
  }
  return { grades, withdrawals: [...withdrawals.values()], skipped };
}
