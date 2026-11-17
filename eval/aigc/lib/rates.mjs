// Rates for the two tracks, always with Wilson intervals.
//
// Objective track: share of takes whose rule graders all pass (withdrawn and
// error takes are excluded and reported separately).
// Subjective track (SeedVideoBench 2.0 reporting): on a 1–5 scale,
//   usability = score >= 3, satisfaction = score >= 4, delight = score == 5;
// multimodal task following is 1–3: follow = 3, partial-or-better >= 2.
// Rates replace the mean score because a mean hides how many takes are usable.

import { createHash } from 'node:crypto';

import { wilsonInterval } from '../../judge/lib/agreement.mjs';

export const RATE_THRESHOLDS = { usability: 3, satisfaction: 4, delight: 5 };
export const TASK_FOLLOWING_THRESHOLDS = { follow: 3, partial: 2 };
export const GROUP_KEYS = ['domain', 'scenario', 'difficulty', 'split', 'model'];

function keyOf(dimension, item, take) {
  if (dimension === 'model') return take?.candidate?.model ?? '—';
  return item?.[dimension] ?? '—';
}

function rate(passed, total) {
  return { passed, total, rate: total ? passed / total : null, interval: wilsonInterval(passed, total) };
}

/** Lower median: conservative when two raters disagree by one band. */
export function lowerMedian(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}

/** Map one score on a dimension to its rate flags. */
export function scoreFlags(score, dim = 'overall') {
  if (dim === 'taskFollowing') return { follow: score >= TASK_FOLLOWING_THRESHOLDS.follow, partial: score >= TASK_FOLLOWING_THRESHOLDS.partial };
  return {
    usability: score >= RATE_THRESHOLDS.usability,
    satisfaction: score >= RATE_THRESHOLDS.satisfaction,
    delight: score >= RATE_THRESHOLDS.delight,
  };
}

function groupRows(rows, groupBy, read) {
  const groups = new Map();
  for (const row of rows) {
    const key = groupBy ? read(row) : 'all';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
}

/**
 * Objective rates. grades from gradeAll(); returns { overall, byGroup: {dim: [{key, ...rate}]}, byGrader, withdrawn, errors }.
 */
export function objectiveRates(grades, items, takes) {
  const itemById = new Map(items.map(item => [item.id, item]));
  const takeById = new Map(takes.map(take => [take.takeId, take]));
  const counted = grades.filter(grade => grade.verdict === 'pass' || grade.verdict === 'fail');
  const summarize = rows => rate(rows.filter(grade => grade.verdict === 'pass').length, rows.length);
  const byGroup = {};
  for (const dimension of GROUP_KEYS) {
    byGroup[dimension] = groupRows(counted, true, grade => keyOf(dimension, itemById.get(grade.itemId), takeById.get(grade.takeId)))
      .map(([key, rows]) => ({ key, ...summarize(rows) }));
  }
  const byGrader = {};
  for (const grade of grades) {
    if (grade.verdict === 'withdrawn') continue;
    for (const result of grade.results) {
      if (result.verdict === 'na') continue;
      const entry = (byGrader[result.grader] ??= { passed: 0, failed: 0, error: 0 });
      if (result.verdict === 'pass') entry.passed += 1;
      else if (result.verdict === 'fail') entry.failed += 1;
      else entry.error += 1;
    }
  }
  for (const entry of Object.values(byGrader)) Object.assign(entry, rate(entry.passed, entry.passed + entry.failed));
  return {
    overall: summarize(counted),
    byGroup,
    byGrader,
    withdrawn: grades.filter(grade => grade.verdict === 'withdrawn').length,
    errors: grades.filter(grade => grade.verdict === 'error').length,
  };
}

/**
 * Per-take scores for one dimension: lower median across raters of one kind.
 * Audit labels and takes of withdrawn items are excluded.
 */
export function takeScores(ratings, { dim = 'overall', raterKind = 'human', withdrawnItems = new Set() } = {}) {
  const byTake = new Map();
  for (const rating of ratings) {
    if (rating.dim !== dim || rating.raterKind !== raterKind || rating.audit || withdrawnItems.has(rating.itemId)) continue;
    if (!byTake.has(rating.takeId)) byTake.set(rating.takeId, { takeId: rating.takeId, itemId: rating.itemId, scores: [] });
    byTake.get(rating.takeId).scores.push(rating.score);
  }
  return [...byTake.values()].map(entry => ({ ...entry, score: lowerMedian(entry.scores) }));
}

/** Subjective rates on one dimension, overall and per group. */
export function subjectiveRates(ratings, items, takes, options = {}) {
  const dim = options.dim ?? 'overall';
  const itemById = new Map(items.map(item => [item.id, item]));
  const takeById = new Map(takes.map(take => [take.takeId, take]));
  const scored = takeScores(ratings, options);
  const flags = dim === 'taskFollowing' ? Object.keys(TASK_FOLLOWING_THRESHOLDS) : Object.keys(RATE_THRESHOLDS);
  const summarize = rows => Object.fromEntries([
    ['n', rows.length],
    ...flags.map(flag => [flag, rate(rows.filter(row => scoreFlags(row.score, dim)[flag]).length, rows.length)]),
  ]);
  const byGroup = {};
  for (const dimension of GROUP_KEYS) {
    byGroup[dimension] = groupRows(scored, true, row => keyOf(dimension, itemById.get(row.itemId), takeById.get(row.takeId)))
      .map(([key, rows]) => ({ key, ...summarize(rows) }));
  }
  return { dim, raterKind: options.raterKind ?? 'human', flags, overall: summarize(scored), byGroup };
}

const band = score => (score >= 5 ? 5 : score >= 4 ? 4 : score >= 3 ? 3 : 1);

/**
 * Deterministic re-audit sample: ~`fraction` of human labels (VBench-2.0 uses 20%),
 * chosen by hashing `takeId/dim/rater` with a seed so the auditor cannot pick.
 */
export function selectAuditSample(ratings, { fraction = 0.2, seed = 'flovart' } = {}) {
  return ratings.filter(rating => rating.raterKind === 'human' && !rating.audit).filter(rating => {
    const hash = createHash('sha256').update(`${seed}:${rating.takeId}/${rating.dim}/${rating.rater}`).digest();
    return hash.readUInt32BE(0) / 0xffffffff < fraction;
  });
}

/**
 * Re-audit agreement: an audit label agrees when it lands in the same rate band
 * (1–2 / 3 / 4 / 5) as the label it audits. The batch passes at >= 95%.
 */
export function auditAgreement(ratings, { passBar = 0.95 } = {}) {
  const originals = new Map();
  for (const rating of ratings) if (!rating.audit) originals.set(`${rating.takeId}/${rating.dim}/${rating.rater}`, rating);
  let agree = 0;
  let total = 0;
  const disagreements = [];
  for (const rating of ratings) {
    if (!rating.audit) continue;
    const original = originals.get(`${rating.takeId}/${rating.dim}/${rating.audit.of}`);
    if (!original) continue;
    total += 1;
    if (band(original.score) === band(rating.score)) agree += 1;
    else disagreements.push({ takeId: rating.takeId, dim: rating.dim, original: original.score, audit: rating.score });
  }
  const agreement = total ? agree / total : null;
  return { total, agree, agreement, passBar, pass: total > 0 && agreement >= passBar, disagreements };
}
