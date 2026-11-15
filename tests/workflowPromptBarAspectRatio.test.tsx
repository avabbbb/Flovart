import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { applyWorkflowOps } from '../components/workflow/ops';
import { ensureWorkflowImageGenerateOperation } from '../components/workflow/operations';
import { WorkflowNodePromptBar } from '../components/workflow/WorkflowNodePromptBar';
import { translations } from '../utils/translations';
import type { UserApiKey } from '../types';
import type { WorkflowNode, WorkflowNodeMetadata } from '../components/workflow/types';

// 2026-11-15 评测：PromptBar 显示 1:1，而节点 metadata.config.aspectRatio 是 16:9。
const t = (key: string, ...args: unknown[]): string => {
  const value = key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object' || !(part in current)) return undefined;
    return (current as Record<string, unknown>)[part];
  }, translations.zho as unknown);
  return String(typeof value === 'function' ? value(...args) : (value ?? key));
};

const seedreamKey = {
  id: 'rh', provider: 'runningHub', capabilities: ['image'], key: 'secret', customModels: [],
  routeMappings: [{ target: { kind: 'product-mode', productModelId: 'flovart:seedream-5-flash', mode: 'text-to-image' as const }, routeId: 'seedream-v5-flash/text-to-image', order: 0 }],
  createdAt: 1, updatedAt: 1,
} as unknown as UserApiKey;

const paramsSummary = () => screen.getByTitle('生成参数').textContent || '';

/** 和画布一样经 update_node 写回（config 合并一层），让测试覆盖真实的合并语义。 */
function applyMetadata(node: WorkflowNode, metadata: Partial<WorkflowNodeMetadata>): WorkflowNode {
  const result = applyWorkflowOps({ nodes: [node], connections: [], selectedNodeIds: [node.id], viewport: { x: 0, y: 0, k: 1 } } as never, [{ type: 'update_node', id: node.id, metadata }]);
  if (result.rejections.length) throw new Error('update_node rejected');
  return result.snapshot.nodes[0];
}

afterEach(cleanup);

describe('WorkflowNodePromptBar aspect ratio follows the node config', () => {
  it('shows the configured 16:9 for a Seedream node and never writes the ratio back', async () => {
    const initial = createWorkflowNode('n1', 'image', { x: 0, y: 0 }, { prompt: 'p', config: { mode: 'image', modelId: 'flovart:seedream-5-flash', aspectRatio: '16:9' } });
    const onChange = vi.fn();
    render(<WorkflowNodePromptBar node={initial} nodes={[initial]} t={t} theme="light" language="zho" userApiKeys={[seedreamKey]}
      dynamicModelOptions={{ text: [], image: ['flovart:seedream-5-flash'], video: [] }} onChange={onChange} onRun={vi.fn()} />);
    await waitFor(() => expect(paramsSummary()).toMatch(/^16:9/));
    for (const [patch] of onChange.mock.calls) expect(patch.config).not.toHaveProperty('aspectRatio');
  });

  it('follows an external (Agent / CLI) ratio change after mount, and its own patches do not revert it', async () => {
    let store = createWorkflowNode('n1', 'image', { x: 0, y: 0 }, { prompt: 'p', config: { mode: 'image', modelId: 'flovart:seedream-5-flash', aspectRatio: '1:1' } });
    const sent: Array<Partial<WorkflowNodeMetadata>> = [];
    let setExternal: (node: WorkflowNode) => void = () => undefined;
    const Harness = () => {
      const [node, setNode] = useState(store);
      setExternal = next => { store = next; setNode(next); };
      return <WorkflowNodePromptBar node={node} nodes={[node]} t={t} theme="light" language="zho" userApiKeys={[seedreamKey]}
        dynamicModelOptions={{ text: [], image: ['flovart:seedream-5-flash'], video: [] }}
        onChange={patch => { sent.push(patch); store = applyMetadata(store, patch); setNode(store); }} onRun={vi.fn()} />;
    };
    render(<Harness />);
    await waitFor(() => expect(paramsSummary()).toMatch(/^1:1/));
    // PromptBar 在旧渲染里算出的补丁（分辨率归一化等）
    const stalePatches = [...sent];
    expect(stalePatches.length).toBeGreaterThan(0);

    // Agent 经 CLI 改成 16:9
    act(() => setExternal(applyMetadata(store, { config: { aspectRatio: '16:9' } as never })));
    await waitFor(() => expect(paramsSummary()).toMatch(/^16:9/));

    // 旧补丁晚到：不能把比例改回 1:1
    let replayed = store;
    for (const patch of stalePatches) replayed = applyMetadata(replayed, patch);
    expect(replayed.metadata.config?.aspectRatio).toBe('16:9');

    // 用户在 PromptBar 改分辨率：比例保持 16:9
    fireEvent.click(screen.getByTitle('生成参数'));
    fireEvent.click(screen.getByRole('button', { name: '2K' }));
    await waitFor(() => expect(store.metadata.config?.resolution).toBe('2K'));
    expect(store.metadata.config?.aspectRatio).toBe('16:9');
    expect(paramsSummary()).toMatch(/^16:9/);
  });

  it('a ratio picked in the PromptBar lands in node config', async () => {
    let store = createWorkflowNode('n1', 'image', { x: 0, y: 0 }, { prompt: 'p', config: { mode: 'image', modelId: 'flovart:seedream-5-flash', aspectRatio: '16:9' } });
    const Harness = () => {
      const [node, setNode] = useState(store);
      return <WorkflowNodePromptBar node={node} nodes={[node]} t={t} theme="light" language="zho" userApiKeys={[seedreamKey]}
        dynamicModelOptions={{ text: [], image: ['flovart:seedream-5-flash'], video: [] }}
        onChange={patch => { store = applyMetadata(store, patch); setNode(store); }} onRun={vi.fn()} />;
    };
    render(<Harness />);
    fireEvent.click(screen.getByTitle('生成参数'));
    fireEvent.click(screen.getByRole('button', { name: '21:9' }));
    await waitFor(() => expect(store.metadata.config?.aspectRatio).toBe('21:9'));
    expect(store.metadata.config?.modelId).toBe('flovart:seedream-5-flash');
    expect(paramsSummary()).toMatch(/^21:9/);
  });

  it('reads the ratio from the Operation recipe when config does not carry it', async () => {
    const src = createWorkflowNode('n1', 'image', { x: 0, y: 0 }, { prompt: 'a cat at dusk', config: { mode: 'image', modelId: 'flovart:seedream-5-flash', aspectRatio: '16:9' } });
    let i = 0;
    const converted = await ensureWorkflowImageGenerateOperation({ project: { id: 'p', name: 'p', nodes: [src], connections: [], selectedNodeIds: [] } as never, nodeId: 'n1', createId: () => 'id' + (i++) });
    const op = converted.project.nodes.find(node => node.id === 'n1')!;
    expect(op.metadata.operation?.recipe.parameters.aspectRatio).toBe('16:9');
    // Agent 直接建的 Operation：只有 recipe 参数，config 里没有比例
    const { aspectRatio: _drop, ...configWithoutRatio } = op.metadata.config!;
    const agentOp = { ...op, metadata: { ...op.metadata, config: configWithoutRatio } } as WorkflowNode;
    render(<WorkflowNodePromptBar node={agentOp} nodes={[agentOp]} t={t} theme="light" language="zho" userApiKeys={[seedreamKey]}
      dynamicModelOptions={{ text: [], image: ['flovart:seedream-5-flash'], video: [] }} onChange={vi.fn()} onRun={vi.fn()} />);
    await waitFor(() => expect(paramsSummary()).toMatch(/^16:9/));
  });
});
