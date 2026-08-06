import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { createWorkflowOperationInputBinding, createWorkflowOperationNode } from '../components/workflow/operations';
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
  it('mounts a visible editable operation card with a stable rerun action', async () => {
    const operation = await cropOperation();
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

  it('keeps the shared PromptBar mounted without assigning a Provider model to local crop', async () => {
    const operation = await cropOperation();
    const source = createWorkflowNode('source-image', 'image', { x: 0, y: 0 }, { storageKey: 'source-key', status: 'success' });
    const video = createWorkflowNode('video-reference', 'video', { x: 0, y: 300 }, { storageKey: 'video-key', status: 'success' });
    const onChange = vi.fn();
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
      onRun={vi.fn()}
    />);

    expect(screen.getByTestId('workflow-node-prompt-bar')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
