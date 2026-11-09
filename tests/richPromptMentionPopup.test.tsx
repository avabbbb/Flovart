import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMentionPopupRenderer,
  nextMentionPopupPhase,
  releasesSuggestionSuppression,
  routeMentionKey,
  suggestionProgrammaticMeta,
  type MentionPopupPhase,
} from '../components/RichPromptEditor';
import type { MentionItem } from '../components/MentionList';

const items: MentionItem[] = [{ id: 'node-1', label: '图片1', thumbnail: '', elementType: 'image' }];
const suggestionProps = (query: string, command = vi.fn()) => ({ query, items, command, clientRect: () => new DOMRect(0, 0, 10, 10) });
const keyDown = (key: string) => ({ event: new KeyboardEvent('keydown', { key }) });
const flushTimers = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });

describe('mention popup phase', () => {
  it('opens, hides on Escape and reopens only when the query changes', () => {
    let phase: MentionPopupPhase = nextMentionPopupPhase({ kind: 'closed' }, { type: 'start', query: '' });
    expect(phase).toEqual({ kind: 'open', query: '' });
    phase = nextMentionPopupPhase(phase, { type: 'escape' });
    expect(phase).toEqual({ kind: 'hidden', query: '' });
    expect(nextMentionPopupPhase(phase, { type: 'update', query: '' })).toBe(phase);
    expect(nextMentionPopupPhase(phase, { type: 'update', query: '图' })).toEqual({ kind: 'open', query: '图' });
    expect(nextMentionPopupPhase(phase, { type: 'exit' })).toEqual({ kind: 'exiting' });
    expect(nextMentionPopupPhase({ kind: 'closed' }, { type: 'update', query: 'x' })).toEqual({ kind: 'closed' });
  });

  it('routes keys to the list only while it is visible', () => {
    expect(routeMentionKey({ kind: 'open', query: '' }, 'Escape')).toBe('hide');
    expect(routeMentionKey({ kind: 'open', query: '' }, 'Enter')).toBe('list');
    expect(routeMentionKey({ kind: 'hidden', query: '' }, 'Enter')).toBe('editor');
    expect(routeMentionKey({ kind: 'hidden', query: '' }, 'ArrowDown')).toBe('editor');
    expect(routeMentionKey({ kind: 'exiting' }, 'Enter')).toBe('editor');
  });

  it('releases programmatic suppression on any user input transaction', () => {
    const tr = (docChanged: boolean, meta: Record<string, unknown> = {}) => ({ docChanged, getMeta: (key: string) => meta[key] });
    expect(releasesSuggestionSuppression(tr(true))).toBe(true);
    expect(releasesSuggestionSuppression(tr(false, { pointer: true }))).toBe(true);
    expect(releasesSuggestionSuppression(tr(false, { composition: 1 }))).toBe(true);
    expect(releasesSuggestionSuppression(tr(false, { uiEvent: 'drop' }))).toBe(true);
    expect(releasesSuggestionSuppression(tr(false))).toBe(false);
    expect(releasesSuggestionSuppression(tr(true, { [suggestionProgrammaticMeta]: true }))).toBe(false);
    expect(releasesSuggestionSuppression(tr(true, { appendedTransaction: {} }))).toBe(false);
  });
});

describe('mention popup renderer', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('keeps the new popup content when @ is retyped before the deferred teardown', async () => {
    const renderer = createMentionPopupRenderer({ current: [] }, { current: [] });
    act(() => renderer.onStart(suggestionProps('')));
    const first = renderer.session;
    act(() => {
      renderer.onExit();
      renderer.onStart(suggestionProps(''));
    });
    const second = renderer.session;
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);

    await flushTimers();

    expect(first?.container.isConnected).toBe(false);
    expect(first?.phase).toEqual({ kind: 'closed' });
    expect(second?.container.isConnected).toBe(true);
    expect(second?.container.childElementCount).toBeGreaterThan(0);
    expect(second?.phase).toEqual({ kind: 'open', query: '' });
  });

  it('lets Enter fall through to the editor after Escape and reopens on further typing', () => {
    const command = vi.fn();
    const renderer = createMentionPopupRenderer({ current: [] }, { current: [] });
    act(() => renderer.onStart(suggestionProps('图', command)));

    let handled = false;
    act(() => { handled = renderer.onKeyDown(keyDown('Escape')); });
    expect(handled).toBe(true);
    expect(renderer.session?.phase.kind).toBe('hidden');

    act(() => { handled = renderer.onKeyDown(keyDown('Enter')); });
    expect(handled).toBe(false);
    act(() => { handled = renderer.onKeyDown(keyDown('ArrowDown')); });
    expect(handled).toBe(false);
    expect(command).not.toHaveBeenCalled();

    act(() => renderer.onUpdate(suggestionProps('图片', command)));
    expect(renderer.session?.phase).toEqual({ kind: 'open', query: '图片' });
    act(() => { handled = renderer.onKeyDown(keyDown('Enter')); });
    expect(handled).toBe(true);
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ id: 'node-1' }));
  });
});
