import { describe, expect, it } from 'vitest';
import { buildPlanCard, paidUnits, SessionBudget } from '../agent/session-budget.js';
import { WorkflowAgentSession } from '../agent/session.js';

describe('session budget', () => {
  it('counts paid units per command', () => {
    expect(paidUnits('workflow.node.run', { nodeId: 'a' })).toBe(1);
    expect(paidUnits('workflow.node.run', { nodeIds: ['a', 'b', 'c'] })).toBe(3);
    expect(paidUnits('generate.image', { count: 4 })).toBe(4);
    expect(paidUnits('workflow.apply', {})).toBe(0);
  });

  it('enforces the ceiling, expiry and pause without touching non-paid commands', () => {
    let clock = 1_000;
    const budget = new SessionBudget({ now: () => clock });
    expect(budget.check('workflow.node.run', { nodeId: 'a' })).toBeNull();
    budget.grant({ maxRuns: 3, ttlMs: 60_000, grantedBy: 'codex' });
    expect(budget.check('workflow.node.run', { nodeIds: ['a', 'b'] })).toBeNull();
    budget.consume('workflow.node.run', { nodeIds: ['a', 'b'] });
    expect(budget.check('workflow.node.run', { nodeIds: ['c', 'd'] }).error.code).toBe('BUDGET_EXCEEDED');
    expect(budget.check('workflow.apply', {})).toBeNull();
    budget.pause('看一下中间结果');
    expect(budget.check('workflow.node.run', { nodeId: 'c' }).error.code).toBe('SESSION_PAUSED');
    budget.resume();
    clock += 61_000;
    expect(budget.check('workflow.node.run', { nodeId: 'c' }).error.code).toBe('BUDGET_EXPIRED');
    expect(() => budget.grant({ maxRuns: 0 })).toThrow(RangeError);
  });

  it('builds a plan card that flags missing nodes and budget blocks', () => {
    const budget = new SessionBudget();
    budget.grant({ maxRuns: 1 });
    const card = buildPlanCard('workflow.node.run', { nodeIds: ['n1', 'ghost'] }, { snapshot: { id: 'p1', nodes: [{ id: 'n1', title: '主图', type: 'image' }] }, budget });
    expect(card).toMatchObject({ kind: 'plan-card', projectId: 'p1', paidRuns: 2, requiresConfirmation: true, missingNodeIds: ['ghost'], wouldBlock: 'BUDGET_EXCEEDED' });
    expect(card.steps[0]).toEqual({ nodeId: 'n1', action: 'run', title: '主图', type: 'image' });
  });
});

describe('session wiring', () => {
  it('answers session controls, dry-runs and budget blocks locally without a browser', async () => {
    const session = new WorkflowAgentSession();
    const granted = await session.callCommand('session.budget.grant', { maxRuns: 1 }, 'cli', undefined, undefined, { agentIdentity: 'codex' });
    expect(granted.result.budget).toMatchObject({ maxRuns: 1, remaining: 1, grantedBy: 'codex' });
    const plan = await session.callCommand('workflow.node.run', { nodeIds: ['a', 'b'], dryRun: true }, 'cli');
    expect(plan.result).toMatchObject({ kind: 'plan-card', paidRuns: 2, wouldBlock: 'BUDGET_EXCEEDED' });
    const blocked = await session.callCommand('workflow.node.run', { nodeIds: ['a', 'b'] }, 'cli');
    expect(blocked).toMatchObject({ ok: false, error: { code: 'BUDGET_EXCEEDED', requiredRuns: 2 } });
    await session.callCommand('session.pause', { reason: 'stop' }, 'cli');
    const paused = await session.callCommand('workflow.node.run', { nodeId: 'a' }, 'cli');
    expect(paused.error.code).toBe('SESSION_PAUSED');
    const state = await session.callCommand('session.budget.get', {}, 'cli');
    expect(state.result).toMatchObject({ paused: true, pauseReason: 'stop' });
  });
});
