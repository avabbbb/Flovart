// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowProject } from '../components/workflow/types';
import {
  insertPromptFromExtension,
  registerWebPromptInsertReceiver,
  type PromptInsertDependencies,
} from '../services/webPromptInsertReceiver';

const project = {
  id: 'p1',
  draftVersion: 3,
  viewport: { x: 20, y: 0, k: 2 },
  nodes: [
    { id: 'img-1', type: 'image', metadata: {} },
    { id: 'note-1', type: 'text', metadata: { content: '备注' } },
  ],
} as unknown as WorkflowProject;

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
  it('creates an idle image generation node with the prompt in its Prompt Bar (never a text node)', async () => {
    const { deps, dispatch } = dependencies();
    const result = await insertPromptFromExtension({ type: 'prompt.insert', text: '  a cat  ' }, deps);
    expect(result).toEqual({ nodeId: 'reverse-1', projectId: 'p1', mode: 'created' });
    const envelope = dispatch.mock.calls[0]?.[0];
    expect(envelope?.command).toBe('workflow.node.create');
    expect(envelope?.args).toMatchObject({ projectId: 'p1', id: 'reverse-1', type: 'image', x: 100, y: 90, metadata: { prompt: 'a cat', status: 'idle' } });
    expect((envelope?.args.metadata as { richTextDocument?: unknown }).richTextDocument).toMatchObject({ type: 'doc' });
    expect(envelope?.args.metadata).not.toHaveProperty('content');
  });

  it('writes into the target generation node when the extension names one, keeping its @chips', async () => {
    const { deps, dispatch } = dependencies();
    const result = await insertPromptFromExtension({ type: 'prompt.insert', text: 'a dog', targetNodeId: 'img-1' }, deps);
    expect(result).toEqual({ nodeId: 'img-1', projectId: 'p1', mode: 'updated' });
    const envelope = dispatch.mock.calls[0]?.[0];
    expect(envelope?.command).toBe('workflow.apply');
    expect(envelope?.args).toMatchObject({ projectId: 'p1', expectedRevision: 3, operations: [{ type: 'update_node', id: 'img-1', metadata: { prompt: 'a dog' } }] });
    // 只给 prompt、不给 richTextDocument：update_node 会保留原有 @引用
    expect((envelope?.args.operations as Array<{ metadata: Record<string, unknown> }>)[0].metadata).not.toHaveProperty('richTextDocument');
    await expect(insertPromptFromExtension({ text: 'x', targetNodeId: 'note-1' }, deps)).rejects.toThrow('生成节点');
    await expect(insertPromptFromExtension({ text: 'x', targetNodeId: 'nope' }, deps)).rejects.toThrow('不存在');
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
