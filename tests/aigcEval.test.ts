// @vitest-environment node
import { describe, expect, it, beforeAll } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { validateAgainst, validateItemShape, validateTakeShape } from '../eval/aigc/lib/schema.mjs';
import { itemSemanticErrors, loadItems, readJsonl, validateDataset } from '../eval/aigc/lib/dataset.mjs';
import { GRADERS } from '../eval/aigc/graders/index.mjs';
import { toolAvailable } from '../eval/aigc/graders/media.mjs';
import { gradeAll, gradeTake, objectiveVerdict, runStable } from '../eval/aigc/lib/grade.mjs';
import { auditAgreement, lowerMedian, objectiveRates, RATE_THRESHOLDS, scoreFlags, selectAuditSample, subjectiveRates, TASK_FOLLOWING_THRESHOLDS } from '../eval/aigc/lib/rates.mjs';
import { openStore } from '../eval/aigc/lib/store.mjs';
import { buildReportModel, renderDashboard } from '../eval/aigc/lib/report.mjs';
import { exportPreferencePairs, finalChoices, preferenceEventErrors } from '../eval/aigc/lib/preferences.mjs';
import { ensureFixtures } from '../eval/aigc/lib/fixtures.mjs';
import { loadRubric } from '../eval/judge/lib/rubric.mjs';
import { judgePair, summarizePairs } from '../eval/judge/lib/pairwise.mjs';

const ROOT = join(__dirname, '..');
const SAMPLES = join(ROOT, 'eval', 'aigc', 'samples');
const items = loadItems();
const takes = readJsonl(join(SAMPLES, 'takes.sample.jsonl'));
const ratings = readJsonl(join(SAMPLES, 'ratings.sample.jsonl'));
const events = readJsonl(join(SAMPLES, 'preference-events.sample.jsonl'));
const byId = (id: string) => structuredClone(items.find(item => item.id === id)) as Record<string, any>;
const strip = ({ __file, ...rest }: Record<string, any>) => rest;
const hasFfmpeg = toolAvailable() && toolAvailable('ffmpeg');

describe('aigc schemas and dataset rules', () => {
  it('accepts the committed sample dataset', () => {
    const { errors } = validateDataset({ items, takes, ratings });
    expect(errors).toEqual([]);
    expect(new Set(items.map(item => item.split))).toEqual(new Set(['dev', 'test', 'holdout']));
  });

  it('rejects shape errors: unknown field, bad domain, no prompt language', () => {
    const item = strip(byId('t2v.ad.dolly-in.001'));
    expect(validateItemShape({ ...item, extra: 1 }).join()).toContain('unknown field extra');
    expect(validateItemShape({ ...item, domain: 'x2y' }).join()).toContain('must be one of');
    expect(validateItemShape({ ...item, prompt: { negative: { zh: 'x' } } }).join()).toContain('anyOf');
  });

  it('enforces domain condition assets, person consent and ref != target', () => {
    const i2v = strip(byId('i2v.social.dance.001'));
    delete i2v.assets.first_frame;
    expect(itemSemanticErrors(i2v).join()).toContain('needs assets.first_frame');

    const dh = strip(byId('dh.pgc.talking-head.001'));
    dh.assets.face_ref[0].consent = { kind: 'cc-by' };
    expect(itemSemanticErrors(dh).join()).toContain('needs consent person-consent');
    dh.assets.face_ref[0].consent = { kind: 'person-consent' };
    expect(itemSemanticErrors(dh).join()).toContain('needs consent.ref');

    const tts = strip(byId('tts.basic.clone.001'));
    tts.assets.ground_truth = [{ ...tts.assets.ref_audio[0] }];
    expect(itemSemanticErrors(tts).join()).toContain('must differ from the target');
  });

  it('checks references: rubrics, check parents, takes and the 1–3 task-following scale', () => {
    const item = strip(byId('t2i.consumer-effects.text-zh.001'));
    item.rubrics = ['nope'];
    item.checks[1].parent = 'missing';
    const errors = itemSemanticErrors(item, { rubricIds: new Set(['image-output']) }).join();
    expect(errors).toContain('rubric nope does not exist');
    expect(errors).toContain('parent missing does not exist');
    const bad = validateDataset({
      items,
      takes: [{ ...takes[0], takeId: 'x', alternatesOf: 'ghost' }],
      ratings: [{ takeId: 'x', itemId: takes[0].itemId, rater: 'r', raterKind: 'human', dim: 'taskFollowing', score: 4 }],
    }).errors.join();
    expect(bad).toContain('alternatesOf ghost');
    expect(bad).toContain('scored 1–3');
  });

  it('take schema requires a model and records the rewritten prompt', () => {
    expect(validateTakeShape({ itemId: 'abc', takeId: 't', candidate: {}, outputs: { video: [{ uri: 'a.mp4', mime: 'video/mp4' }] } }).join()).toContain('missing model');
    expect(takes[0].candidate.rewrittenPrompt).toBeTruthy();
  });

  it('the mini validator refuses keywords it does not implement', () => {
    expect(() => validateAgainst({ type: 'string', format: 'email' }, 'x')).toThrow(/not supported/);
  });
});

describe('aigc rates', () => {
  it('maps 1–5 scores to usability / satisfaction / delight and 1–3 to task following', () => {
    expect(scoreFlags(3)).toEqual({ usability: true, satisfaction: false, delight: false });
    expect(scoreFlags(5)).toEqual({ usability: true, satisfaction: true, delight: true });
    expect(scoreFlags(2, 'taskFollowing')).toEqual({ follow: false, partial: true });
    expect(lowerMedian([5, 4])).toBe(4);
    expect(lowerMedian([2, 5, 3])).toBe(3);
  });

  it('rubric scales agree with the thresholds the rates use', async () => {
    for (const id of ['video-shot', 'digital-human']) {
      const rubric = await loadRubric(join(ROOT, 'eval', 'judge', 'rubrics'), id);
      expect(rubric.scales.quality.rates).toEqual(RATE_THRESHOLDS);
      expect(rubric.scales.taskFollowing.rates).toEqual(TASK_FOLLOWING_THRESHOLDS);
    }
  });

  it('subjective rates use the lower median per take, skip audits and withdrawn items, and carry Wilson intervals', () => {
    const result = subjectiveRates(ratings, items, takes, { dim: 'overall', raterKind: 'human' });
    // t2v-a (4,5)→4, t2v-b (2,2)→2, i2v (3,4)→3, dh 3, tts 5, t2i-a 4
    expect(result.overall.n).toBe(6);
    expect(result.overall.usability.passed).toBe(5);
    expect(result.overall.satisfaction.passed).toBe(3);
    expect(result.overall.delight.passed).toBe(1);
    expect(result.overall.usability.interval.low).toBeLessThan(result.overall.usability.rate);
    const byDomain = Object.fromEntries(result.byGroup.domain.map(row => [row.key, row]));
    expect(byDomain.t2v.n).toBe(2);
    const withdrawn = subjectiveRates(ratings, items, takes, { withdrawnItems: new Set(['t2v.ad.dolly-in.001']) });
    expect(withdrawn.overall.n).toBe(4);
  });

  it('objective rates exclude withdrawn and error takes', () => {
    const grades = [
      { itemId: 'a', takeId: '1', verdict: 'pass', results: [] },
      { itemId: 'a', takeId: '2', verdict: 'fail', results: [] },
      { itemId: 'b', takeId: '3', verdict: 'withdrawn', results: [] },
      { itemId: 'b', takeId: '4', verdict: 'error', results: [] },
    ];
    const result = objectiveRates(grades, [], []);
    expect(result.overall).toMatchObject({ passed: 1, total: 2, rate: 0.5 });
    expect(result.withdrawn).toBe(1);
    expect(result.errors).toBe(1);
  });

  it('re-audit samples ~20% deterministically and passes at 95% same-band agreement', () => {
    const many = Array.from({ length: 500 }, (_, index) => ({ takeId: `t${index}`, itemId: 'i', rater: 'r1', raterKind: 'human', dim: 'overall', score: 4 }));
    const sample = selectAuditSample(many);
    expect(sample.length).toBeGreaterThan(70);
    expect(sample.length).toBeLessThan(130);
    expect(selectAuditSample(many)).toEqual(sample);
    const audits = sample.map(rating => ({ ...rating, rater: 'aud', audit: { of: 'r1' }, score: rating.takeId === sample[0].takeId ? 2 : 4 }));
    const verdict = auditAgreement([...many, ...audits]);
    expect(verdict.total).toBe(sample.length);
    expect(verdict.disagreements).toHaveLength(1);
    expect(verdict.pass).toBe(verdict.agreement! >= 0.95);
  });
});

describe('grader stability → withdrawal', () => {
  const item = { id: 'x.item', domain: 't2v', constraints: {} };
  const take = { itemId: 'x.item', takeId: 't1', outputs: { video: [{ uri: 'v.mp4', mime: 'video/mp4' }] } };
  let flip = 0;
  const flaky = { id: 'flaky', version: '0.0.1', describe: '', applies: () => true, run: () => ({ verdict: (flip += 1) % 2 ? 'pass' : 'fail', value: null }) };
  const steady = { id: 'steady', version: '0.0.1', describe: '', applies: () => true, run: () => ({ verdict: 'pass', value: 1 }) };

  it('detects a nondeterministic grader', () => {
    expect(runStable(steady, item, take, {}, 3).stable).toBe(true);
    expect(runStable(flaky, item, take, {}, 3)).toMatchObject({ stable: false, variants: 2 });
  });

  it('withdraws the item (all its takes) instead of counting it', () => {
    const items = [item];
    const takesFor = [take, { ...take, takeId: 't2' }];
    let calls = 0;
    const flakyOnFirstTake = { ...flaky, id: 'flaky-first', run: (_i: unknown, t: { takeId: string }) => ({ verdict: t.takeId === 't1' && (calls += 1) === 2 ? 'fail' : 'pass', value: null }) };
    const { grades, withdrawals } = gradeAll(items, takesFor, {}, { graders: [steady, flakyOnFirstTake], repeats: 3 });
    expect(withdrawals).toEqual([{ itemId: 'x.item', reason: 'grader-unstable:flaky-first', takeId: 't1' }]);
    expect(grades.map(grade => grade.verdict)).toEqual(['withdrawn', 'withdrawn']);
  });

  it('a throwing grader is an error, never a pass', () => {
    const boom = { id: 'boom', version: '0', describe: '', applies: () => true, run: () => { throw new Error('x'); } };
    const grade = gradeTake(item, take, {}, { graders: [boom] });
    expect(grade.verdict).toBe('error');
    expect(objectiveVerdict([{ verdict: 'na' }, { verdict: 'pass' }])).toBe('pass');
  });

  it('skips takes whose item is already withdrawn in the dataset', () => {
    const { grades, skipped } = gradeAll([{ ...item, status: 'withdrawn', statusReason: 'r' }], [take], {}, { graders: [steady] });
    expect(grades).toEqual([]);
    expect(skipped[0].reason).toContain('withdrawn');
  });
});

describe.skipIf(!hasFfmpeg)('objective graders on generated media', () => {
  let fixturesDir = '';
  beforeAll(() => {
    fixturesDir = mkdtempSync(join(tmpdir(), 'aigc-fixtures-'));
    ensureFixtures(fixturesDir);
  }, 60_000);

  it('grades the sample takes as expected and is stable across repeats', () => {
    const { grades, withdrawals } = gradeAll(items, takes, { fixturesDir, mediaRoot: ROOT }, { repeats: 2 });
    expect(withdrawals).toEqual([]);
    const verdicts = Object.fromEntries(grades.map(grade => [grade.takeId, grade.verdict]));
    expect(verdicts).toEqual({
      't2v-001-a': 'pass',
      't2v-001-b': 'fail',
      'i2v-001-a': 'pass',
      'dh-001-a': 'fail',
      'tts-001-a': 'pass',
      't2i-001-a': 'pass',
      't2i-001-b': 'fail',
    });
    const result = (takeId: string, grader: string) => grades.find(grade => grade.takeId === takeId)!.results.find(r => r.grader === grader)!;
    expect(result('t2v-001-b', 'dynamic-degree')).toMatchObject({ verdict: 'fail', value: 0 });
    expect(result('t2v-001-a', 'dynamic-degree').value).toBeGreaterThan(0.01);
    expect(result('dh-001-a', 'av-duration-match')).toMatchObject({ verdict: 'fail' });
    expect(result('dh-001-a', 'av-duration-match').value).toBeCloseTo(1, 1);
    expect(result('i2v-001-a', 'aspect').verdict).toBe('pass');
    expect(result('i2v-001-a', 'av-duration-match').verdict).toBe('na');
    expect(result('t2i-001-b', 'file-valid').detail).not.toContain(fixturesDir);
    expect(grades.find(grade => grade.takeId === 't2v-001-a')!.checks).toEqual({ 'not-static': 'pass', 'has-audio': 'pass' });
  }, 60_000);

  it('a remote URI is never fetched and never passes', () => {
    const remote = { ...takes[0], takeId: 'remote', outputs: { video: [{ uri: 'https://example.com/v.mp4', mime: 'video/mp4' }] } };
    const grade = gradeTake(byId('t2v.ad.dolly-in.001'), remote, { fixturesDir });
    expect(grade.verdict).toBe('error');
  });

  it('end to end: store (sqlite and jsonl) → report with escaped HTML', () => {
    for (const backend of ['sqlite', 'jsonl'] as const) {
      const dir = mkdtempSync(join(tmpdir(), `aigc-store-${backend}-`));
      const store = openStore(dir, { backend });
      expect(store.backend).toBe(backend);
      const { grades, withdrawals } = gradeAll(items, takes, { fixturesDir }, { repeats: 1 });
      store.addTakes(takes);
      store.addGradeRun({ runId: 'r1', createdAt: '2026-11-17T00:00:00Z', grades, withdrawals });
      store.addRatings(ratings);
      store.addRatings([ratings[0]]);
      const run = store.latestGradeRun()!;
      expect(run.grades).toHaveLength(7);
      expect(store.ratings()).toHaveLength(ratings.length);
      const model = buildReportModel({ items, takes: store.takes(), gradeRun: run, ratings: store.ratings() });
      store.close();
      expect(model.objective.overall).toMatchObject({ passed: 4, total: 7 });
      expect(model.withdrawn.map(entry => entry.itemId)).toEqual(['r2v.ad.product-combine.001']);
      expect(model.subjective.human.overall.overall.n).toBe(6);
      expect(model.subjective.judge.overall.overall.n).toBe(2);
      const html = renderDashboard({ ...model, gradeRun: { runId: '<script>x</script>' } as never });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('可用率');
    }
  }, 60_000);
});

describe('preference events → judge pairs', () => {
  it('rejects events that carry media', () => {
    expect(preferenceEventErrors(events[0])).toEqual([]);
    expect(preferenceEventErrors({ ...events[0], chosen: { id: 'a', href: 'x' } }).join()).toContain('media field href');
    expect(preferenceEventErrors({ ...events[0], prompt: 'see data:image/png;base64,AAAA' }).join()).toContain('media bodies');
  });

  it('keeps the latest user choice per node and ignores agent picks', () => {
    const flipped = { ...events[0], id: 'pe-later', time: '2026-11-17T04:00:00.000Z', chosen: { id: 'alt-3', type: 'image' }, rejected: [{ id: 'alt-2', type: 'image' }] };
    const agent = { ...events[1], id: 'pe-agent', actor: 'agent', nodeId: 'other' };
    const final = finalChoices([...events, flipped, agent]);
    expect(final.map(event => event.id)).toEqual(['pe-demo-2', 'pe-later']);
  });

  it('exports pairs with balanced positions whose truth points at the chosen side', async () => {
    const { pairs, truth } = exportPreferencePairs(events);
    expect(pairs).toHaveLength(3);
    for (const pair of pairs) {
      const event = events.find(e => pair.id.startsWith(`${e.id}:`))!;
      const chosenSide = truth[pair.id] === 'A' ? pair.refs.a : pair.refs.b;
      expect(chosenSide).toBe(event.chosen.id);
      expect(pair).toEqual(expect.objectContaining({ id: expect.any(String), task: expect.any(String), a: expect.any(String), b: expect.any(String) }));
    }
    // A replayed judge that always prefers the chosen side agrees 100% under the position swap.
    const provider = {
      id: 'replay',
      async complete({ key, user }: { key: string; user: string }) {
        const id = key.split('#')[0];
        const pair = pairs.find(p => p.id === id)!;
        const chosen = truth[id] === 'A' ? pair.a : pair.b;
        const x = user.split('### 候选 X\n')[1].split('\n')[0];
        return { text: JSON.stringify({ winner: x === chosen ? 'X' : 'Y' }) };
      },
    };
    const results = [];
    for (const pair of pairs) results.push(await judgePair({ ...pair, criteria: ['更好'] }, provider));
    expect(summarizePairs(results, truth)).toMatchObject({ swapConsistency: 1, accuracyOnConsistent: 1, labelled: 3 });
  });
});

describe('cli', () => {
  it('validate passes on the sample dataset', () => {
    const run = spawnSync(process.execPath, ['eval/aigc/run.mjs', 'validate', '--takes', 'eval/aigc/samples/takes.sample.jsonl', '--ratings', 'eval/aigc/samples/ratings.sample.jsonl'], { cwd: ROOT, encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout.trim())).toMatchObject({ items: 7, errors: 0 });
    expect(readFileSync(join(ROOT, 'eval', 'schema', 'aigc-item.schema.json'), 'utf8')).toContain('holdout');
  });
});
