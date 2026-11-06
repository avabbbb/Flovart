import { describe, expect, it } from 'vitest';
import {
  consumeSpendMandate,
  createSpendMandate,
  describeMandateDenial,
  evaluateSpendMandate,
  planBlocked,
  type AgentConfirmRequest,
} from '../services/agentSpendMandate';
import type { GenerationGateDetails } from '../services/generationGate';

const gate = (extra: Partial<GenerationGateDetails> = {}) => ({ serviceLabel: 'svc', modelLabel: 'm', mediaType: 'video', taskCount: 1, ...extra }) as GenerationGateDetails;
const gen = (...gates: GenerationGateDetails[]): AgentConfirmRequest => ({ kind: 'generation', command: 'workflow.node.run', gates });
const blocker = { code: 'reference-limit', message: '参考视频超长' };

describe('agent batch plan approval', () => {
  it('treats any node blocker as blocking the whole batch', () => {
    expect(planBlocked(gen(gate(), gate()))).toBe(false);
    expect(planBlocked(gen(gate(), gate({ blockers: [blocker] })))).toBe(true);
    expect(planBlocked(undefined)).toBe(false);
  });

  it('never auto-approves a blocked batch, even inside the mandate', () => {
    const mandate = createSpendMandate({ maxTasks: 50 });
    expect(evaluateSpendMandate(mandate, gen(gate(), gate({ blockers: [blocker] })))).toEqual({ allow: false, reason: 'plan-blocked' });
    expect(evaluateSpendMandate(mandate, gen(gate({ warnings: [{ code: 'retry-new-task', message: 'x' }] })))).toEqual({ allow: true });
  });

  it('explains a task-cap denial with the remainder and batch size', () => {
    const used = consumeSpendMandate(createSpendMandate({ maxTasks: 10 }), gen(gate({ taskCount: 8 })));
    const batch = gen(gate(), gate(), gate(), gate());
    expect(describeMandateDenial(used, batch)).toBe('超出本次授权：已用 8/10 个生成任务，本批 4 个');
    expect(describeMandateDenial(used, gen(gate()))).toBeUndefined();
    expect(describeMandateDenial(null, batch)).toBeUndefined();
  });
});
