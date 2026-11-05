// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowProject } from '../components/workflow/types';
import {
  insertPromptFromExtension,
  registerWebPromptInsertReceiver,
  type PromptInsertDependencies,
} from '../services/webPromptInsertReceiver';

const project = { id: 'p1', viewport: { x: 20, y: 0, k: 2 } } as unknown as WorkflowProject;

function dependencies(active: WorkflowProject | null = project) {
  const dispatch = vi.fn(async (_envelope: { command: string; args: Record<string, unknown> }) => ({ ok: true }));
  const deps = {
    getActiveProject: () => active,
    dispatch,
    createId: () => 'reverse-1',
  } as unknown as PromptInsertDependencies;
  return { deps, dispatch };
}

describe('web prompt.insert receiver', () => {
  it('creates a text node in the active workflow', async () => {
    const { deps, dispatch } = dependencies();
    const result = await insertPromptFromExtension({ type: 'prompt.insert', text: '  a cat  ' }, deps);
    expect(result).toEqual({ nodeId: 'reverse-1', projectId: 'p1' });
    const envelope = dispatch.mock.calls[0]?.[0];
    expect(envelope?.command).toBe('workflow.node.create');
    expect(envelope?.args).toMatchObject({ projectId: 'p1', id: 'reverse-1', type: 'text', x: 100, y: 90, metadata: { content: 'a cat' } });
  });

  it('rejects empty text and a missing project', async () => {
    await expect(insertPromptFromExtension({ text: '   ' }, dependencies().deps)).rejects.toThrow('为空');
    await expect(insertPromptFromExtension({ text: 'x' }, dependencies(null).deps)).rejects.toThrow('Workflow');
  });

  it('registers on prompt.insert', () => {
    const dispose = vi.fn();
    const onRequest = vi.fn(() => dispose);
    expect(registerWebPromptInsertReceiver({ onRequest }, dependencies().deps)).toBe(dispose);
    expect(onRequest).toHaveBeenCalledWith('prompt.insert', expect.any(Function));
  });
});
