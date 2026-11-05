import { describe, expect, it } from 'vitest';
import { classifyFailure, decideRetry, planAssembly, planShotSegments, rewritePromptForRetry, splitDuration } from '../components/workflow/shotAssembly';

const shot = (nodeId: string, index: number, durationSec: number | undefined, hasMedia: boolean) => ({ nodeId, index, title: nodeId, durationSec, anchorNodeIds: [], hasMedia });

describe('shotAssembly', () => {
  it('splits long durations into capped equal segments', () => {
    expect(splitDuration(60, 15)).toEqual([15, 15, 15, 15]);
    expect(splitDuration(62, 15)).toEqual([12.4, 12.4, 12.4, 12.4, 12.4]);
    expect(splitDuration(10, 15)).toEqual([10]);
    expect(splitDuration(0, 15)).toEqual([]);
  });

  it('plans segments in shot order and splits oversized shots', () => {
    const segments = planShotSegments([{ index: 2, durationSec: 30 }, { index: 1, durationSec: 5 }, { index: 3 }], 15);
    expect(segments.map(s => [s.order, s.shotIndex, s.part, s.parts, s.durationSec])).toEqual([
      [1, 1, 1, 1, 5], [2, 2, 1, 2, 15], [3, 2, 2, 2, 15], [4, 3, 1, 1, 15],
    ]);
  });

  it('reports assembly readiness with ordered source ids', () => {
    const ready = planAssembly({ shots: [shot('b', 2, 5, true), shot('a', 1, 4, true)] });
    expect(ready).toMatchObject({ ready: true, sourceNodeIds: ['a', 'b'], missingShots: [], durationSec: 9 });
    const blocked = planAssembly({ shots: [shot('a', 1, 4, true), shot('b', 2, 5, false), shot('c', 2, 5, true)] });
    expect(blocked.ready).toBe(false);
    expect(blocked.missingShots).toEqual([2]);
    expect(blocked.blockers.join('|')).toMatch(/重复/);
  });

  it('classifies failures conservatively', () => {
    expect(classifyFailure('SEEDANCE_SUBMISSION_UNKNOWN', 'timeout')).toBe('abort');
    expect(classifyFailure('PROVIDER_VALIDATION_FAILED', '内容审核未通过')).toBe('rewrite');
    expect(classifyFailure('PROVIDER_REQUEST_FAILED', 'HTTP 503')).toBe('retry');
    expect(classifyFailure('PROVIDER_VALIDATION_FAILED', 'API Key 已过期')).toBe('abort');
  });

  it('rewrites prompts deterministically and stops at the cap', () => {
    expect(rewritePromptForRetry('血腥的战斗场面', 1).split('\n')[0]).toBe('的战斗场面');
    const first = decideRetry({ code: 'RUN_FAILED', message: 'content policy violation', prompt: 'gore scene', attempt: 1 });
    expect(first.action).toBe('rewrite');
    expect(first.prompt).not.toMatch(/gore/);
    expect(decideRetry({ code: 'RUN_FAILED', message: 'content policy violation', prompt: 'x', attempt: 3 }).action).toBe('abort');
  });
});
