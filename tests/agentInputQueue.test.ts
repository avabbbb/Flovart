import { describe, expect, it } from 'vitest';
import {
  draftPreview, mergeDrafts, moveToFront, popLastQueued, promoteToSteer, queuedCount, removeInput,
  requeueSteers, routeRunningSubmit, shiftQueued, trayOrder, type PendingInput,
} from '../components/agent/agentInputQueue';

type Ref = { id: string; type: string; label: string };
type Att = { name: string };
const draft = (text: string, extra: Partial<PendingInput<Ref, Att>['draft']> = {}) => ({ text, quote: null, references: [], attachments: [], ...extra });
const item = (id: string, kind: 'steer' | 'queued'): PendingInput<Ref, Att> => ({ id, kind, draft: draft(id) });

describe('agent input queue (codex pending input)', () => {
  it('routes Enter to steer and Tab to queue while running', () => {
    expect(routeRunningSubmit({ key: 'enter', answerStreaming: false, steerable: true })).toBe('steer');
    expect(routeRunningSubmit({ key: 'tab', answerStreaming: false, steerable: true })).toBe('queued');
  });

  it('queues Enter while the final answer is streaming or when steering is unavailable', () => {
    expect(routeRunningSubmit({ key: 'enter', answerStreaming: true, steerable: true })).toBe('queued');
    expect(routeRunningSubmit({ key: 'enter', answerStreaming: false, steerable: false })).toBe('queued');
  });

  it('orders the tray steers first, then queued in FIFO order', () => {
    const items = [item('q1', 'queued'), item('s1', 'steer'), item('q2', 'queued'), item('s2', 'steer')];
    expect(trayOrder(items).map(entry => entry.id)).toEqual(['s1', 's2', 'q1', 'q2']);
    expect(queuedCount(items)).toBe(2);
  });

  it('drains queued items one at a time, first in first out, skipping steers', () => {
    const items = [item('s1', 'steer'), item('q1', 'queued'), item('q2', 'queued')];
    const first = shiftQueued(items);
    expect(first.next?.id).toBe('q1');
    expect(first.rest.map(entry => entry.id)).toEqual(['s1', 'q2']);
    expect(shiftQueued(first.rest).next?.id).toBe('q2');
    expect(shiftQueued([item('s1', 'steer')]).next).toBeUndefined();
  });

  it('pops the last queued item for editing and never a steer', () => {
    const { item: popped, rest } = popLastQueued([item('q1', 'queued'), item('q2', 'queued'), item('s1', 'steer')]);
    expect(popped?.id).toBe('q2');
    expect(rest.map(entry => entry.id)).toEqual(['q1', 's1']);
    expect(popLastQueued([item('s1', 'steer')]).item).toBeUndefined();
  });

  it('requeues undelivered steers ahead of other queued items, keeping their order', () => {
    const items = [item('q1', 'queued'), item('s1', 'steer'), item('s2', 'steer')];
    expect(requeueSteers(items).map(entry => `${entry.kind}:${entry.id}`)).toEqual(['queued:s1', 'queued:s2', 'queued:q1']);
    expect(requeueSteers(items, ['s2']).map(entry => `${entry.kind}:${entry.id}`)).toEqual(['steer:s1', 'queued:s2', 'queued:q1']);
  });

  it('send-now promotes a queued item to steer, or moves it to the front when it cannot steer', () => {
    const items = [item('q1', 'queued'), item('q2', 'queued')];
    expect(promoteToSteer(items, 'q2').find(entry => entry.id === 'q2')?.kind).toBe('steer');
    expect(moveToFront(items, 'q2').map(entry => entry.id)).toEqual(['q2', 'q1']);
    expect(removeInput(items, 'q1').map(entry => entry.id)).toEqual(['q2']);
  });

  it('merges restored drafts in front of what is being typed', () => {
    const a = { id: 'n1', type: 'node', label: '图1' };
    const merged = mergeDrafts<Ref, Att>([
      draft('先写脚本', { references: [a] }),
      draft('再出图', { quote: '引文', references: [a], attachments: [{ name: 'x.png' }] }),
    ], draft('正在写'));
    expect(merged.text).toBe('先写脚本\n\n再出图\n\n正在写');
    expect(merged.quote).toBe('引文');
    expect(merged.references).toEqual([a]);
    expect(merged.attachments).toEqual([{ name: 'x.png' }]);
  });

  it('previews a draft on one line', () => {
    expect(draftPreview<Ref, Att>(draft('第一行\n第二行', { references: [{ id: 'n', type: 'node', label: '图' }] }))).toBe('第一行 第二行 · @图');
    expect(draftPreview<Ref, Att>(draft('', { quote: '只有引文' }))).toBe('只有引文');
  });
});
