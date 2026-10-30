import { describe, expect, it } from 'vitest';
import {
  consumeSpendMandate,
  createSpendMandate,
  defaultMandateTasks,
  evaluateSpendMandate,
  spendDemand,
  type AgentConfirmRequest,
} from '../services/agentSpendMandate';
import type { GenerationGateDetails } from '../services/generationGate';

const gate = (taskCount: number, estimatedCost?: GenerationGateDetails['estimatedCost']): GenerationGateDetails => ({
  serviceLabel: 'svc', modelLabel: 'm', mediaType: 'video', taskCount, estimatedCost,
});
const gen = (...gates: GenerationGateDetails[]): AgentConfirmRequest => ({ kind: 'generation', command: 'workflow.node.run', gates });

describe('agentSpendMandate', () => {
  it('sums tasks and only reports cost when every gate has a same-currency estimate', () => {
    expect(spendDemand([gate(2, { amount: 1, currency: 'CNY' }), gate(1, { amount: 0.5, currency: 'CNY' })])).toEqual({ tasks: 3, cost: { amount: 1.5, currency: 'CNY' } });
    expect(spendDemand([gate(1, { amount: 1, currency: 'CNY' }), gate(1)]).cost).toBeNull();
    expect(spendDemand([gate(1, { amount: 1, currency: 'CNY' }), gate(1, { amount: 1, currency: 'USD' })]).cost).toBeNull();
  });

  it('never covers non-generation or missing mandate', () => {
    expect(evaluateSpendMandate(createSpendMandate({ maxTasks: 10 }), { kind: 'destructive', command: 'workflow.node.delete' })).toEqual({ allow: false, reason: 'not-generation' });
    expect(evaluateSpendMandate(null, gen(gate(1)))).toEqual({ allow: false, reason: 'no-mandate' });
    expect(evaluateSpendMandate(createSpendMandate({ maxTasks: 10 }), gen())).toEqual({ allow: false, reason: 'unknown-demand' });
  });

  it('allows within task cap and stops once exceeded', () => {
    let mandate = createSpendMandate({ maxTasks: 9 });
    mandate = consumeSpendMandate(mandate, gen(gate(1), gate(1), gate(1)));
    expect(evaluateSpendMandate(mandate, gen(gate(6)))).toEqual({ allow: true });
    mandate = consumeSpendMandate(mandate, gen(gate(6)));
    expect(evaluateSpendMandate(mandate, gen(gate(1)))).toEqual({ allow: false, reason: 'tasks-exceeded' });
  });

  it('requires a known estimate when a money cap is set', () => {
    const mandate = createSpendMandate({ maxTasks: 20, maxCost: { amount: 10, currency: 'CNY' } });
    expect(evaluateSpendMandate(mandate, gen(gate(1)))).toEqual({ allow: false, reason: 'cost-unknown' });
    expect(evaluateSpendMandate(mandate, gen(gate(1, { amount: 4, currency: 'CNY' })))).toEqual({ allow: true });
    const used = consumeSpendMandate(mandate, gen(gate(2, { amount: 8, currency: 'CNY' })));
    expect(evaluateSpendMandate(used, gen(gate(1, { amount: 3, currency: 'CNY' })))).toEqual({ allow: false, reason: 'cost-exceeded' });
  });

  it('rejects invalid caps and defaults to at least the batch size', () => {
    expect(() => createSpendMandate({ maxTasks: 0 })).toThrow();
    expect(defaultMandateTasks(gen(gate(1)))).toBe(10);
    expect(defaultMandateTasks(gen(...Array.from({ length: 12 }, () => gate(1))))).toBe(12);
  });
});
