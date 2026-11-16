import { describe, expect, it } from 'vitest';
import { applyThinkingDelta, applyTextDelta, carryLiveState, finishThinking, finishThinkingById } from '../components/agent/agentStreamMessages';
import type { WorkflowAgentDisplayMessage } from '../components/workflow/WorkflowAgentMessages';

describe('agentStreamMessages', () => {
  it('accumulates reasoning then freezes its duration on the first answer token', () => {
    let items: WorkflowAgentDisplayMessage[] = [];
    items = applyThinkingDelta(items, 's1', '先看', 1000);
    items = applyThinkingDelta(items, 's1', '画布', 2000);
    expect(items[0]).toMatchObject({ role: 'assistant', text: '', thinking: '先看画布', thinkingStartedAt: 1000 });
    items = applyTextDelta(items, 's1', '好的', 4500);
    items = applyTextDelta(items, 's1', '。', 9000);
    expect(items[0]).toMatchObject({ text: '好的。', thinkingDone: true, thinkingMs: 3500 });
  });

  it('creates a plain assistant message for text without reasoning', () => {
    expect(applyTextDelta([], 's2', 'hi', 1)).toEqual([{ id: 's2', role: 'assistant', text: 'hi' }]);
    expect(applyThinkingDelta([], 's2', '', 1)).toEqual([]);
  });

  it('finishes reasoning when the turn moves to a tool call', () => {
    const items = applyThinkingDelta([], 's3', '调工具', 100);
    const done = finishThinkingById(items, 's3', 700);
    expect(done[0]).toMatchObject({ thinkingDone: true, thinkingMs: 600 });
    expect(finishThinkingById(done, 's3', 9999)).toBe(done);
    const plain = { id: 'x', role: 'assistant' as const, text: 'a' };
    expect(finishThinking(plain, 5)).toBe(plain);
  });

  it('carries live tool args, results and timings onto the end-of-turn snapshot', () => {
    const live: WorkflowAgentDisplayMessage[] = [
      { id: 'tool-c1', role: 'tool', text: 'ok', toolName: 'flovart_workflow_media_view', args: { nodeIds: ['n1'] }, detail: { content: [{ type: 'image', data: 'AAAA' }] }, startedAt: 10, endedAt: 830, status: 'success' },
      { id: 's1', role: 'assistant', text: '好', thinking: '想', thinkingDone: true, thinkingMs: 1200 },
    ];
    const snapshot: WorkflowAgentDisplayMessage[] = [
      { id: 'e2', role: 'tool', text: 'ok', toolName: 'flovart_workflow_media_view', toolCallId: 'c1', status: 'success' },
      { id: 'e3', role: 'assistant', text: '好', thinking: '想', thinkingDone: true },
      { id: 'e4', role: 'tool', text: 'x', toolCallId: 'unknown', status: 'success' },
    ];
    const merged = carryLiveState(live, snapshot);
    expect(merged[0]).toMatchObject({ id: 'e2', args: { nodeIds: ['n1'] }, startedAt: 10, endedAt: 830 });
    expect((merged[0].detail as { content: unknown[] }).content).toHaveLength(1);
    expect(merged[1].thinkingMs).toBe(1200);
    expect(merged[2]).toBe(snapshot[2]);
  });
});
