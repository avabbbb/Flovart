import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { loadAllRubrics, loadRubric, parseRubric, compileJudgePrompt, renderSampleMessage } from '../eval/judge/lib/rubric.mjs';
import { aggregateSample, summarize } from '../eval/judge/lib/funnel.mjs';
import { parseJudgeOutput, normaliseVerdict } from '../eval/judge/lib/parse.mjs';
import { cleanSample, redactSecrets } from '../eval/judge/lib/clean.mjs';
import { judgeWithRounds } from '../eval/judge/lib/judge.mjs';
import { judgePair, summarizePairs } from '../eval/judge/lib/pairwise.mjs';
import { cohensKappa, sampleSizeForMargin, wilsonInterval } from '../eval/judge/lib/agreement.mjs';
import { screenRule, stabilitySelect, updateMemory, trustedPairs } from '../eval/judge/lib/autorubrics.mjs';
import { admissionGate, grayGate, driftCheck } from '../eval/judge/lib/gate.mjs';
import { attribute } from '../eval/judge/lib/attribution.mjs';

const RUBRICS = join(__dirname, '..', 'eval', 'judge', 'rubrics');

const mini = parseRubric(`---
id: mini
version: 1.0.0
title: mini
appliesTo: test
inputs:
  reply: reply
items:
  - { code: M-CTX-01, layer: CTX, pass: ok, fail: x, na: missing }
  - { code: M-TOOL-01, layer: TOOL, pass: ok, fail: x }
  - { code: M-CONTENT-01, layer: CONTENT, pass: ok, fail: x }
  - { code: M-RED-01, layer: RED, pass: ok, fail: x }
changelog:
  - { version: 1.0.0, date: 2026-11-16, change: init }
---
body`, 'mini');

const v = (verdict: 0 | 1 | 'NA') => ({ verdict, evidence: verdict === 1 ? 'quote' : null, reason: '' });

function replay(table: Record<string, unknown>) {
  return {
    id: 'test',
    async complete({ key }: { key: string }) {
      if (!(key in table)) throw new Error(`no ${key}`);
      const value = table[key];
      return { text: typeof value === 'string' ? value : JSON.stringify(value), usage: null };
    },
  };
}

describe('rubric contract', () => {
  it('loads every shipped rubric and compiles a prompt from the file', async () => {
    const rubrics = await loadAllRubrics(RUBRICS);
    expect(rubrics.map(r => r.id).sort()).toEqual(['agent-run', 'digital-human', 'image-output', 'prompt-static', 'sop-recall', 'video-shot']);
    for (const rubric of rubrics) {
      const prompt = compileJudgePrompt(rubric);
      for (const item of rubric.items) expect(prompt).toContain(item.code);
      expect(prompt).toContain('只依据用户消息里提供的输入判断');
      expect(['L1', 'L2', 'L3', 'L4', 'L5']).toContain(rubric.evalLayer);
    }
  });

  it('rejects NA outside CTX, missing RED, and a version without changelog', () => {
    expect(() => parseRubric(`---\nid: x\nversion: 1.0.0\ntitle: x\nappliesTo: x\nitems:\n  - { code: X-CTX-01, layer: CTX, pass: a, fail: b }\n  - { code: X-CONTENT-01, layer: CONTENT, pass: a, fail: b, na: c }\nchangelog: []\n---\n`, 'x'))
      .toThrow(/only CTX items may define NA[\s\S]*RED item is required[\s\S]*changelog has no entry/);
  });

  it('sends only declared inputs to the judge', async () => {
    const rubric = await loadRubric(RUBRICS, 'agent-run');
    const message = renderSampleMessage(rubric, { inputs: { user_request: 'hi', secret_field: 'nope' }, evalTime: 't' });
    expect(message).toContain('user_request');
    expect(message).not.toContain('nope');
  });
});

describe('funnel aggregation', () => {
  it('short-circuits serial layers at the first failure but always evaluates RED', () => {
    const result = aggregateSample(mini, { 'M-CTX-01': v(1), 'M-TOOL-01': v(0), 'M-CONTENT-01': v(1), 'M-RED-01': v(0) });
    expect(result.verdict).toBe(0);
    expect(result.primaryFailure).toBe('TOOL');
    expect(result.layers.CONTENT).toBe('NA');
    expect(result.redFailed).toBe(true);
    expect(result.failedItems).toEqual(['M-TOOL-01', 'M-RED-01']);
  });

  it('excludes a CTX NA from the denominator unless RED fails', () => {
    const skipped = aggregateSample(mini, { 'M-CTX-01': v('NA'), 'M-TOOL-01': v(1), 'M-CONTENT-01': v(1), 'M-RED-01': v(1) });
    expect(skipped.verdict).toBe('NA');
    const summary = summarize([{ aggregate: skipped }, { aggregate: aggregateSample(mini, { 'M-CTX-01': v(1), 'M-TOOL-01': v(1), 'M-CONTENT-01': v(1), 'M-RED-01': v(1) }) }]);
    expect(summary.excluded).toBe(1);
    expect(summary.passRate).toBe(1);
    const redStillCounts = aggregateSample(mini, { 'M-CTX-01': v('NA'), 'M-TOOL-01': v(1), 'M-CONTENT-01': v(1), 'M-RED-01': v(0) });
    expect(redStillCounts.verdict).toBe(0);
  });
});

describe('execution success funnel', () => {
  const staged = parseRubric(`---
id: staged
version: 1.0.0
title: staged
appliesTo: test
items:
  - { code: S-CTX-01, layer: CTX, pass: ok, fail: x, na: m }
  - { code: S-TOOL-01, layer: TOOL, stage: route, pass: ok, fail: x }
  - { code: S-TOOL-02, layer: TOOL, stage: call, pass: ok, fail: x }
  - { code: S-CONTENT-01, layer: CONTENT, stage: output, pass: ok, fail: x }
  - { code: S-CONTENT-02, layer: CONTENT, stage: reply, pass: ok, fail: x }
  - { code: S-RED-01, layer: RED, pass: ok, fail: x }
changelog:
  - { version: 1.0.0, date: 2026-11-16, change: init }
---
`, 'staged');
  const run = (route: 0 | 1, call: 0 | 1, output: 0 | 1, reply: 0 | 1, red: 0 | 1 = 1) => ({
    aggregate: aggregateSample(staged, {
      'S-CTX-01': v(1), 'S-TOOL-01': v(route), 'S-TOOL-02': v(call), 'S-CONTENT-01': v(output), 'S-CONTENT-02': v(reply), 'S-RED-01': v(red),
    }),
  });

  it('chains route x call x output x reply into end-to-end execution success', () => {
    const summary = summarize([run(1, 1, 1, 1), run(0, 1, 1, 1), run(1, 1, 0, 1), run(1, 1, 1, 0), run(1, 1, 1, 1, 0)]);
    expect(summary.stageFunnel.route).toMatchObject({ reached: 4, passed: 3 });
    expect(summary.stageFunnel.output).toMatchObject({ reached: 3, passed: 2 });
    expect(summary.stageFunnel.reply).toMatchObject({ reached: 2, passed: 1 });
    expect(summary.executionSuccess).toBeCloseTo(1 / 5);
    expect(summary.executionSuccess).toBe(summary.passRate);
  });

  it('rejects an unknown stage', () => {
    expect(() => parseRubric(`---\nid: x\nversion: 1.0.0\ntitle: x\nappliesTo: x\nitems:\n  - { code: X-CTX-01, layer: CTX, pass: a, fail: b }\n  - { code: X-RED-01, layer: RED, stage: deploy, pass: a, fail: b }\nchangelog:\n  - { version: 1.0.0 }\n---\n`, 'x')).toThrow(/stage must be one of/);
  });
});

describe('judge output defence', () => {
  it('extracts fenced JSON and normalises loose verdicts', () => {
    const text = '好的：\n```json\n{"items":{"M-CTX-01":{"evidence":"q","verdict":"通过"},"M-TOOL-01":{"evidence":"q","verdict":"1"},"M-CONTENT-01":{"verdict":"fail"},"M-RED-01":{"evidence":"q","verdict":true}}}\n```';
    const parsed = parseJudgeOutput(mini, text);
    expect(parsed.ok).toBe(true);
    expect(parsed.verdicts['M-CONTENT-01'].verdict).toBe(0);
    expect(normaliseVerdict('剔除')).toBe('NA');
  });

  it('refuses non-standard verdicts, NA outside CTX, and a pass without evidence', () => {
    const parsed = parseJudgeOutput(mini, {
      items: { 'M-CTX-01': { verdict: 'maybe' }, 'M-TOOL-01': { verdict: 'NA' }, 'M-CONTENT-01': { verdict: 1 }, 'M-RED-01': { verdict: 0 } },
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/non-standard[\s\S]*only allowed on CTX[\s\S]*without quoted evidence/);
  });
});

describe('cleaning', () => {
  it('parses stringified JSON, isolates the current turn, and redacts secrets', () => {
    const sample = cleanSample({
      id: 's1',
      turnId: 2,
      inputs: {
        tool_calls: JSON.stringify([{ cmd: 'a', turnId: 1 }, { cmd: 'b', turnId: 2, headers: { authorization: 'Bearer abcdefghijklmnopqrstuvwxyz' } }]),
        // Assembled at runtime so the tracked-secret audit does not read the fixture as a real key.
        agent_reply: `key is ${['sk', 'abcdefghijklmnopqrstuvwxyz123'].join('-')}`,
      },
    });
    expect(sample.inputs.tool_calls).toHaveLength(1);
    expect(JSON.stringify(sample.inputs)).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(sample.cleaning.notes.join('\n')).toMatch(/parsed stringified JSON[\s\S]*kept 1\/2/);
    expect(redactSecrets('token=abcdef123456').hits).toBe(1);
  });
});

describe('multi-round stability', () => {
  it('marks a sample unstable when rounds disagree instead of majority voting', async () => {
    const pass = { items: { 'M-CTX-01': v(1), 'M-TOOL-01': v(1), 'M-CONTENT-01': v(1), 'M-RED-01': v(1) } };
    const fail = { items: { ...pass.items, 'M-CONTENT-01': v(0) } };
    const sample = { id: 's', inputs: { reply: 'x' }, images: [] };
    const result = await judgeWithRounds(mini, sample, replay({ s: pass, 's#r1': pass, 's#r2': fail }), 3);
    expect(result.stable).toBe(false);
  });
});

describe('pairwise with position swap', () => {
  it('counts only order-independent preferences', async () => {
    const provider = replay({
      'p1#ab': '{"winner":"X"}', 'p1#ba': '{"winner":"Y"}',
      'p2#ab': '{"winner":"X"}', 'p2#ba': '{"winner":"X"}',
    });
    const r1 = await judgePair({ id: 'p1', task: 't', a: 'A', b: 'B', criteria: ['c'] }, provider);
    const r2 = await judgePair({ id: 'p2', task: 't', a: 'A', b: 'B', criteria: ['c'] }, provider);
    expect(r1.outcome).toBe('A');
    expect(r2.outcome).toBe('biased');
    const summary = summarizePairs([r1, r2], { p1: 'A' });
    expect(summary.swapConsistency).toBe(0.5);
    expect(summary.accuracyOnConsistent).toBe(1);
  });
});

describe('agreement statistics', () => {
  it('computes kappa, Wilson interval and CI sample size', () => {
    expect(cohensKappa([[1, 1], [0, 0], [1, 1], [0, 0]]).kappa).toBe(1);
    expect(cohensKappa([[1, 0], [0, 1]]).kappa).toBeLessThan(0);
    expect(sampleSizeForMargin(0.01)).toBe(9604);
    const band = wilsonInterval(8, 10)!;
    expect(band.low).toBeGreaterThan(0.4);
    expect(band.high).toBeLessThan(1);
  });
});

describe('auto rubrics', () => {
  it('classifies rules by two-sided violation rate', () => {
    expect(screenRule('a', { good: [false, false, false, false, true], bad: [true, true, true, true, false] }).type).toBe('strong');
    expect(screenRule('b', { good: [true, true], bad: [false, true] }).type).toBe('fake');
    expect(screenRule('c', { good: [true, false], bad: [true, false] }).type).toBe('low');
  });

  it('keeps only rules picked across folds and reports the train/validation gap', () => {
    const pairs = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      chosenViolates: { good: false, noise: i % 2 === 0 },
      rejectedViolates: { good: true, noise: i % 2 === 1 },
    }));
    const result = stabilitySelect(['good', 'noise'], pairs, { k: 5 });
    expect(result.stable).toEqual(['good']);
    expect(result.validationAccuracy).toBe(1);
    expect(result.overfit).toBe(false);
  });

  it('moves rules through active / degraded / removed / recovered', () => {
    let memory = updateMemory({}, ['a', 'b']);
    memory = updateMemory(memory, ['a']);
    expect(memory.b.state).toBe('degraded');
    memory = updateMemory(memory, ['a', 'b']);
    expect(memory.b.state).toBe('recovered');
    memory = updateMemory(updateMemory(memory, ['a']), ['a']);
    expect(memory.b.state).toBe('removed');
    expect(trustedPairs({ x: ['correct', 'correct', 'correct'], y: ['correct', 'wrong', 'correct'] })).toEqual(['x']);
  });
});

describe('governance gates', () => {
  const base = { passRate: 0.9, redFailures: 0, parseErrors: 0 };
  it('admission blocks on rule-layer failure, RED, regression, or a weak judge', () => {
    expect(admissionGate({ baseline: base, candidate: base, deterministic: { passRate: 1 } }).pass).toBe(true);
    const blocked = admissionGate({ baseline: base, candidate: { ...base, passRate: 0.8, redFailures: 1 }, deterministic: { passRate: 0.95 }, judgeHealth: { kappa: 0.4 } });
    expect(blocked.pass).toBe(false);
    expect(blocked.reasons).toHaveLength(4);
  });

  it('gray pauses after two consecutive losing days and monitor flags drift', () => {
    const day = (d: string, c: number, t: number) => ({ day: d, control: { passed: c, total: 100 }, treatment: { passed: t, total: 100 } });
    expect(grayGate([day('1', 80, 70), day('2', 80, 85), day('3', 80, 70)]).pass).toBe(true);
    expect(grayGate([day('1', 80, 70), day('2', 80, 75)]).pass).toBe(false);
    expect(driftCheck({ passed: 900, total: 1000 }, { passed: 80, total: 100 }).drift).toBe(true);
    expect(driftCheck({ passed: 900, total: 1000 }, { passed: 90, total: 100 }).drift).toBe(false);
  });
});

describe('attribution', () => {
  it('routes parse failures to prompt, altered evidence to data, and confirmed failures to agent', () => {
    const failed = aggregateSample(mini, { 'M-CTX-01': v(1), 'M-TOOL-01': v(0), 'M-CONTENT-01': v(1), 'M-RED-01': v(1) });
    const buckets = attribute(
      [{ id: 'a', parseError: 'x' }, { id: 'b', aggregate: failed }, { id: 'c', aggregate: failed }],
      { labels: { c: { verdict: 0 } }, samples: { b: { cleaning: { notes: ['inputs.tool_calls: truncated 9000 -> 6000 chars'] } } } },
    );
    expect(buckets.prompt.map(e => e.id)).toEqual(['a']);
    expect(buckets.data.map(e => e.id)).toEqual(['b']);
    expect(buckets.agent.map(e => e.id)).toEqual(['c']);
  });
});
