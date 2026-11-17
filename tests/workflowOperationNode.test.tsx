import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowOperationInputBinding, createWorkflowOperationNode, updateWorkflowOperationFromMetadata } from '../components/workflow/operations';
import { WorkflowNode } from '../components/workflow/WorkflowNode';
import { WorkflowNodePromptBar } from '../components/workflow/WorkflowNodePromptBar';
import type { UserApiKey } from '../types';

const t = (key: string) => key;
const imageKey: UserApiKey = {
  id: 'image-key', provider: 'openai', capabilities: ['image'], key: 'secret', customModels: ['gpt-image-2'],
  routeMappings: [{ target: { kind: 'product-mode', productModelId: 'flovart:gpt-image-2', mode: 'text-to-image' }, routeId: 'gpt-image-2', order: 0 }],
  createdAt: 1, updatedAt: 1,
};

async function cropOperation() {
  return createWorkflowOperationNode({
    id: 'crop-operation', capabilityId: 'image.crop@1', position: { x: 400, y: 0 },
    parameters: { x: .1, y: .2, width: .8, height: .6 },
    inputBindings: [createWorkflowOperationInputBinding('crop-input', 'source-image', 'source_image', 0)],
  });
}

describe('workflow operation node surface', () => {
  it('creates result nodes (not operation nodes) and shows the take version strip on them', async () => {
    const created = await cropOperation();
    expect(created.type).toBe('image');
    const take = (id: string, storageKey: string) => ({
      id, status: 'success' as const, recipeHash: 'h', createdAt: '2026-11-18T00:00:00.000Z', completedAt: '2026-11-18T00:00:01.000Z',
      snapshot: { id: 's-' + id, createdAt: '2026-11-18T00:00:00.000Z', compilerVersion: 'workflow-operation@1', renderedPrompt: '', parameters: {}, inputBindings: [], recipeHash: 'h' },
      outputNodeIds: [created.id], outputMedia: { storageKey, mimeType: 'image/png' },
    });
    const result = {
      ...created,
      metadata: { ...created.metadata, status: 'success' as const, storageKey: 'k-2', mimeType: 'image/png', operation: { ...created.metadata.operation!, takes: [take('t1', 'k-1'), take('t2', 'k-2')], selectedTakeId: 't2' } },
    };
    const onSelectTake = vi.fn();
    render(<WorkflowNode
      node={result}
      selected
      onPointerDown={vi.fn()}
      onConnectStart={vi.fn()}
      onResizeStart={vi.fn()}
      onChangeText={vi.fn()}
      onChangeMetadata={vi.fn()}
      onRun={vi.fn()}
      onSelectTake={onSelectTake}
      onContextMenu={vi.fn()}
      onReplaceMedia={vi.fn()}
      onRemoveMedia={vi.fn()}
    />);
    expect(screen.queryByTestId('workflow-operation-card')).toBeNull();
    const strip = screen.getByTestId('workflow-operation-versions');
    expect(strip).toHaveTextContent('v1');
    expect(strip).toHaveTextContent('v2');
    fireEvent.click(screen.getByRole('button', { name: 'v1' }));
    expect(onSelectTake).toHaveBeenCalledWith('t1');
  });

  it('still renders a legacy operation node (undo history / imports) as a compatibility card', async () => {
    const operation = { ...(await cropOperation()), type: 'operation' as const };
    const onRun = vi.fn();
    render(<WorkflowNode
      node={operation}
      selected
      onPointerDown={vi.fn()}
      onConnectStart={vi.fn()}
      onResizeStart={vi.fn()}
      onChangeText={vi.fn()}
      onChangeMetadata={vi.fn()}
      onRun={onRun}
      onContextMenu={vi.fn()}
      onReplaceMedia={vi.fn()}
      onRemoveMedia={vi.fn()}
    />);

    expect(screen.getByTestId('workflow-operation-card')).toHaveTextContent('80% × 60%');
    expect(screen.getByTestId('workflow-operation-card')).toHaveTextContent('1 输入 · 0 Take');
    fireEvent.click(screen.getByRole('button', { name: '运行' }));
    expect(onRun).toHaveBeenCalledOnce();
  });

  it('derives a legacy video Operation card and mode from the same capability registry', async () => {
    const created = await createWorkflowOperationNode({
      id: 'trim-operation', capabilityId: 'video.trim@1', position: { x: 400, y: 0 },
      parameters: { startSec: 1, endSec: 4 },
      inputBindings: [createWorkflowOperationInputBinding('trim-input', 'source-video', 'source_video', 0)],
    });
    const operation = { ...created, type: 'operation' as const };
    render(<WorkflowNode
      node={operation}
      selected
      onPointerDown={vi.fn()}
      onConnectStart={vi.fn()}
      onResizeStart={vi.fn()}
      onChangeText={vi.fn()}
      onChangeMetadata={vi.fn()}
      onRun={vi.fn()}
      onContextMenu={vi.fn()}
      onReplaceMedia={vi.fn()}
      onRemoveMedia={vi.fn()}
    />);
    expect(operation.metadata.config?.mode).toBe('video');
    expect(screen.getByTestId('workflow-operation-card')).toHaveTextContent('1.0s → 4.0s');
  });

  it('keeps the shared PromptBar mounted without assigning a Provider model to local crop', async () => {
    const operation = await cropOperation();
    const source = createWorkflowNode('source-image', 'image', { x: 0, y: 0 }, { storageKey: 'source-key', status: 'success' });
    const video = createWorkflowNode('video-reference', 'video', { x: 0, y: 300 }, { storageKey: 'video-key', status: 'success' });
    const onChange = vi.fn();
    const onRun = vi.fn();
    render(<WorkflowNodePromptBar
      node={operation}
      nodes={[operation, source, video]}
      connections={[{ id: 'crop-input', fromNodeId: source.id, toNodeId: operation.id, kind: 'operation-input', role: 'source_image', order: 0 }]}
      t={t}
      theme="light"
      language="zho"
      userApiKeys={[imageKey]}
      dynamicModelOptions={{ text: [], image: ['flovart:gpt-image-2'], video: [] }}
      onChange={onChange}
      onRun={onRun}
    />);

    expect(screen.getByTestId('workflow-node-prompt-bar')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '运行' }));
    await waitFor(() => expect(onRun).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText('宽度'), { target: { value: '70' } });
    const patch = onChange.mock.calls.at(-1)?.[0];
    expect(patch.config.operationParameters).toEqual({ x: .1, y: .2, width: .7, height: .6 });
    const updated = updateWorkflowOperationFromMetadata(operation, patch, '2026-08-06T00:00:00.000Z');
    expect(updated.metadata.operation?.recipe).toMatchObject({ parameters: { x: .1, y: .2, width: .7, height: .6 }, recipeHash: null });
  });

  it('edits video parameters through the Registry controls and rejects invalid cross-field values', async () => {
    const operation = await createWorkflowOperationNode({
      id: 'trim-operation', capabilityId: 'video.trim@1', position: { x: 400, y: 0 },
      parameters: { startSec: 1, endSec: 4 },
      inputBindings: [createWorkflowOperationInputBinding('trim-input', 'source-video', 'source_video', 0)],
    });
    const source = createWorkflowNode('source-video', 'video', { x: 0, y: 0 }, { storageKey: 'video-key', status: 'success' });
    const onChange = vi.fn();
    render(<WorkflowNodePromptBar
      node={operation}
      nodes={[operation, source]}
      connections={[{ id: 'trim-input', fromNodeId: source.id, toNodeId: operation.id, kind: 'operation-input', role: 'source_video', order: 0 }]}
      t={t}
      theme="light"
      language="zho"
      userApiKeys={[]}
      dynamicModelOptions={{ text: [], image: [], video: [] }}
      onChange={onChange}
      onRun={vi.fn()}
    />);

    fireEvent.change(screen.getByLabelText('开始'), { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ config: expect.objectContaining({ operationParameters: { startSec: 2, endSec: 4 } }) }));
    onChange.mockClear();
    fireEvent.change(screen.getByLabelText('开始'), { target: { value: '5' } });
    expect(onChange).not.toHaveBeenCalled();
  });
});
