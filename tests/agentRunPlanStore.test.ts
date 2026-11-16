import { describe, expect, it } from 'vitest';
import { clearRunPlans, compactRunPlanRequest, MAX_PLANS_PER_SESSION, readRunPlans, RUN_PLAN_STORAGE_KEY, saveRunPlan, type StoredRunPlan } from '../components/agent/agentRunPlanStore';
import type { AgentConfirmRequest } from '../services/agentSpendMandate';
import type { GenerationGateDetails } from '../services/generationGate';

const memoryStorage = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
};
const gate = { serviceLabel: 'RunningHub', modelLabel: 'image-g-2', mediaType: 'image', taskCount: 1 } as GenerationGateDetails;
const request = (nodeIds: string[]): AgentConfirmRequest => ({ kind: 'generation', command: 'workflow.node.run', args: { nodeIds, prompt: 'x'.repeat(5000) }, gates: nodeIds.map(() => gate) });
const plan = (id: string, decidedAt: number, extra: Partial<StoredRunPlan> = {}): StoredRunPlan => ({ id, request: request(['a', 'b']), decision: 'auto', decidedAt, turnIndex: 0, ...extra });

describe('run plan store', () => {
  it('saves per project + session and restores in decision order', () => {
    const storage = memoryStorage();
    saveRunPlan('p1', 's1', plan('late', 20, { decision: 'manual', turnIndex: 2 }), storage);
    saveRunPlan('p1', 's1', plan('early', 10), storage);
    saveRunPlan('p1', 's2', plan('other', 5), storage);
    saveRunPlan('p2', 's1', plan('other-project', 5), storage);
    const restored = readRunPlans('p1', 's1', storage);
    expect(restored.map(item => item.id)).toEqual(['early', 'late']);
    expect(restored[1]).toMatchObject({ decision: 'manual', turnIndex: 2, decidedAt: 20 });
    expect(readRunPlans('p1', 's2', storage).map(item => item.id)).toEqual(['other']);
    expect(readRunPlans('p2', 's1', storage).map(item => item.id)).toEqual(['other-project']);
  });

  it('keeps only the fields the card needs', () => {
    const storage = memoryStorage();
    saveRunPlan('p', 's', plan('a', 1), storage);
    const [stored] = readRunPlans('p', 's', storage);
    expect(stored.request.args).toEqual({ nodeIds: ['a', 'b'] });
    expect(stored.request.gates).toHaveLength(2);
    expect(storage.data.get(RUN_PLAN_STORAGE_KEY)!.length).toBeLessThan(1000);
    expect(compactRunPlanRequest({ kind: 'generation', command: 'workflow.node.run', args: { nodeId: 'x' } }).args).toEqual({ nodeIds: ['x'] });
  });

  it('replaces a plan with the same id and caps each session', () => {
    const storage = memoryStorage();
    saveRunPlan('p', 's', plan('a', 1), storage);
    saveRunPlan('p', 's', plan('a', 2, { decision: 'adjust' }), storage);
    expect(readRunPlans('p', 's', storage)).toHaveLength(1);
    expect(readRunPlans('p', 's', storage)[0].decision).toBe('adjust');
    for (let i = 0; i < MAX_PLANS_PER_SESSION + 5; i += 1) saveRunPlan('p', 's', plan(`n${i}`, 100 + i), storage);
    const plans = readRunPlans('p', 's', storage);
    expect(plans).toHaveLength(MAX_PLANS_PER_SESSION);
    expect(plans.at(-1)!.id).toBe(`n${MAX_PLANS_PER_SESSION + 4}`);
  });

  it('ignores missing session ids, corrupt data and clears on delete', () => {
    const storage = memoryStorage();
    expect(saveRunPlan('p', '', plan('a', 1), storage)).toEqual([]);
    expect(storage.data.size).toBe(0);
    storage.setItem(RUN_PLAN_STORAGE_KEY, '{not json');
    expect(readRunPlans('p', 's', storage)).toEqual([]);
    storage.setItem(RUN_PLAN_STORAGE_KEY, JSON.stringify({ sessions: { 'p\u0000s': { updatedAt: 1, plans: [{ id: 'bad' }, plan('ok', 1)] } } }));
    expect(readRunPlans('p', 's', storage).map(item => item.id)).toEqual(['ok']);
    clearRunPlans('p', 's', storage);
    expect(readRunPlans('p', 's', storage)).toEqual([]);
    expect(storage.data.has(RUN_PLAN_STORAGE_KEY)).toBe(false);
  });

  it('survives an unavailable storage', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); }, removeItem: () => undefined };
    expect(readRunPlans('p', 's', broken)).toEqual([]);
    expect(() => saveRunPlan('p', 's', plan('a', 1), broken)).not.toThrow();
  });
});
