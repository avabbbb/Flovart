import { describe, expect, it } from 'vitest';
import { aggregate } from '../eval/lib/engine.mjs';
import { buildReport, renderReportMarkdown } from '../eval/lib/report.mjs';

function trial(trialIndex: number, options: { runner?: string; success?: boolean; blocked?: boolean } = {}) {
  const blocked = options.blocked ?? false;
  const success = !blocked && (options.success ?? true);
  return {
    taskId: 'reliability-case',
    runner: options.runner ?? 'cli',
    suite: 'workflow',
    trialIndex,
    success,
    blocked,
    failureClass: null,
    hardGateFailures: [],
    predicates: { passed: [], failed: [] },
    predicateAccuracy: success ? 1 : 0,
    safety: {},
    efficiency: { toolCalls: 1 },
    timing: { wallTimeMs: 10 },
    usage: { measured: false },
  };
}

const fiveTrials = (runner = 'cli') => [1, 2, 3, 4, 5].map(index => trial(index, { runner }));

describe('Iris evaluation statistics', () => {
  it('does not certify five-run reliability from one success and four blocked trials', () => {
    const result = aggregate([trial(1), ...[2, 3, 4, 5].map(index => trial(index, { blocked: true }))]);
    expect(result.passAt1).toBe(1);
    expect(result.executedTrials).toBe(1);
    expect(result.blockedTrials).toBe(4);
    expect(result.passPow5).toBeNull();
    expect(result.completeFiveTrialGroups).toBe(0);
    expect(result.incompleteFiveTrialGroups).toBe(1);
    expect(result.perSuite.workflow.passAt1).toBe(result.passAt1);
    expect(result.perSuite.workflow.passPow5).toBeNull();
  });

  it('reports complete successful and failing five-trial groups with separate denominators', () => {
    const entries = fiveTrials();
    expect(aggregate(entries).passPow5).toBe(1);
    entries[4] = trial(5, { success: false });
    const result = aggregate(entries);
    expect(result.passAt1).toBe(0.8);
    expect(result.passPow5).toBe(0);
    expect(result.completeFiveTrialGroups).toBe(1);
    expect(result.stableFiveTrialGroups).toBe(0);
  });

  it('does not combine incomplete runs from different runners into a complete cohort', () => {
    const result = aggregate([
      trial(1), trial(2),
      trial(3, { runner: 'mcp' }), trial(4, { runner: 'mcp' }), trial(5, { runner: 'mcp' }),
    ]);
    expect(result.taskRunnerGroups).toBe(2);
    expect(result.incompleteFiveTrialGroups).toBe(2);
    expect(result.passPow5).toBeNull();
  });

  it('reports runner-specific reliability and keeps incomplete coverage visible', () => {
    const mcp = fiveTrials('mcp');
    mcp[4] = trial(5, { runner: 'mcp', success: false });
    const result = aggregate([...fiveTrials(), ...mcp, trial(1, { runner: 'oracle' })]);
    expect(result.tasks).toBe(1);
    expect(result.taskRunnerGroups).toBe(3);
    expect(result.completeFiveTrialGroups).toBe(2);
    expect(result.incompleteFiveTrialGroups).toBe(1);
    expect(result.passPow5).toBe(0.5);
    expect(result.perSuite.workflow.passPow5).toBe(0.5);
    expect(result.stableTasks).toBe(0);
  });

  it('does not treat duplicate, short or longer cohorts as complete five-trial measurements', () => {
    expect(aggregate([trial(1)]).passPow5).toBeNull();
    expect(aggregate([trial(1), trial(2), trial(3), trial(4), trial(4)]).passPow5).toBeNull();
    expect(aggregate([...fiveTrials(), trial(6)]).passPow5).toBeNull();
  });

  it('reports no executed trials as unmeasured instead of a zero capability score', () => {
    const result = aggregate([1, 2, 3, 4, 5].map(index => trial(index, { blocked: true })));
    expect(result.passAt1).toBeNull();
    expect(result.passPow5).toBeNull();
    expect(result.perSuite.workflow.passAt1).toBeNull();
  });

  it('renders measured denominators and unmeasured reliability consistently with JSON', () => {
    const entries = [trial(1), ...[2, 3, 4, 5].map(index => trial(index, { blocked: true }))];
    const report = buildReport({
      run: { id: 'synthetic-statistics-check', command: 'run', tasks: ['reliability-case'], repeat: 5 },
      summary: { aggregate: aggregate(entries), entries },
    });
    expect(report.dataset[0].passAt1).toBe(1);
    expect(report.dataset[0].executedTrials).toBe(1);
    expect(report.dataset[0].blockedTrials).toBe(4);
    const markdown = renderReportMarkdown(report);
    expect(markdown).toContain('pass@1: 100.0% (1/1 executed)');
    expect(markdown).toContain('pass^5: n/a (0/0 complete task/runner groups)');
    expect(markdown).toContain('Five-trial coverage: 0/1 groups; 1 incomplete');
  });

  it('does not reuse legacy reliability percentages without their completion coverage', () => {
    const entries = [trial(1)];
    const legacy = { ...aggregate(entries), passPow5: 1 };
    Reflect.deleteProperty(legacy, 'completeFiveTrialGroups');
    const report = buildReport({
      run: { id: 'legacy-statistics-check', command: 'run', tasks: ['reliability-case'], repeat: 1 },
      summary: { aggregate: legacy, entries },
    });
    expect(renderReportMarkdown(report)).toContain('pass^5: n/a (legacy aggregate');
  });

  it('labels separate-run agent evidence as a reference and lists current coverage gaps', () => {
    const entries = fiveTrials();
    const report = buildReport({
      run: {
        id: 'current-core-run', command: 'run', group: 'core',
        runners: ['oracle', 'cli', 'mcp'], tasks: ['reliability-case'], repeat: 5,
        excludedKnownGaps: ['known-gap-case'],
        skippedForSurface: [{ taskId: 'scoped-case', runner: 'mcp', reason: 'requires approval UI' }],
      },
      summary: { aggregate: aggregate(entries), entries },
      baselines: { agent: {
        ...aggregate(entries), runId: 'older-agent-run', startedAt: '2026-09-01T00:00:00Z',
        certifiedTrials: 5, standInTrials: 0,
      } },
    });
    const markdown = renderReportMarkdown(report);
    expect(markdown).toContain('Reference source run: older-agent-run (2026-09-01T00:00:00Z)');
    expect(markdown).toContain('not a measurement of the current run or checkout');
    expect(markdown).toContain('Excluded known gaps: known-gap-case');
    expect(markdown).toContain('scoped-case / mcp: requires approval UI');
    expect(markdown).not.toContain('Certified external agent runs');
    expect(report.reproduce.thisRun).toBe('node eval/run.mjs run --group core --runner oracle,cli,mcp --repeat 5');
  });
});
