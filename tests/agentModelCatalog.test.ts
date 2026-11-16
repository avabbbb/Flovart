import { afterEach, describe, expect, it } from 'vitest';
import { agentModelCatalogSummary, normalizeOperationModelIds, setAgentModelKeysProvider } from '../services/agentModelCatalog';
import { createWorkflowNode } from '../components/workflow/constants';
import type { WorkflowDocumentOperation } from '../components/workflow/types';

// 2026-11-16 内置 Agent 实测 P1-1：Agent 写入自己编的 modelId（seedream-5.0-flash），要到确认卡才报错。
describe('agent model catalog', () => {
  afterEach(() => setAgentModelKeysProvider(null));

  it('exposes real product model ids for the Agent', () => {
    const summary = agentModelCatalogSummary();
    expect(summary.image.map(item => item.id)).toContain('flovart:seedream-5-flash');
    expect(summary.video.map(item => item.id)).toContain('flovart:seedance-2');
    expect(summary.image.every(item => item.id.includes(':'))).toBe(true);
  });

  it('rejects an invented model id with a list of valid ids', () => {
    const ops = [{ type: 'add_node', node: { id: 'n', type: 'config', metadata: { config: { mode: 'image', modelId: 'seedream-5-0-flash-made-up' } } } }] as unknown as WorkflowDocumentOperation[];
    expect(() => normalizeOperationModelIds(ops, [])).toThrow(/不是可用的图片产品模型。可用 id：.*flovart:seedream-5-flash/);
  });

  it('rejects a video model on an image node and validates update_node against the existing node mode', () => {
    const node = createWorkflowNode('cfg', 'config', { x: 0, y: 0 }, { config: { mode: 'image' } } as never);
    const ops = [{ type: 'update_node', id: 'cfg', patch: { metadata: { config: { modelId: 'flovart:seedance-2' } } } }] as unknown as WorkflowDocumentOperation[];
    expect(() => normalizeOperationModelIds(ops, [node])).toThrow('不是可用的图片产品模型');
  });

  it('normalizes known aliases (the id the Agent guessed) to the canonical id', () => {
    const node = createWorkflowNode('cfg', 'config', { x: 0, y: 0 }, { config: { mode: 'image' } } as never);
    const [op] = normalizeOperationModelIds([
      { type: 'update_node', id: 'cfg', metadata: { config: { modelId: 'seedream-5.0-flash', count: 2 } } },
    ] as unknown as WorkflowDocumentOperation[], [node]) as Array<{ metadata: { config: { modelId: string; count: number } } }>;
    expect(op.metadata.config).toEqual({ modelId: 'flovart:seedream-5-flash', count: 2 });
  });

  it('leaves text nodes and ops without modelId untouched', () => {
    const ops = [
      { type: 'add_node', node: { id: 't', type: 'config', metadata: { config: { mode: 'text', modelId: 'any-llm' } } } },
      { type: 'update_node', id: 'x', patch: { title: '改名' } },
    ] as unknown as WorkflowDocumentOperation[];
    expect(normalizeOperationModelIds(ops, [])).toEqual(ops);
  });
});
