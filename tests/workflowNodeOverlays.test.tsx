import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { WorkflowNodeToolbar } from '../components/workflow/WorkflowNodeToolbar';
import { WorkflowNodePromptBar } from '../components/workflow/WorkflowNodePromptBar';

const t = (key: string) => key;
const node = createWorkflowNode('image', 'image', { x: 100, y: 80 }, {
  prompt: '初始提示词',
  config: { mode: 'image', modelId: 'image-model' },
});

describe('workflow node overlays', () => {
  it('uses the shared toolbar shell and exposes only wired actions', () => {
    const onCopy = vi.fn();
    const onDelete = vi.fn();
    render(<WorkflowNodeToolbar nodes={[node]} onCopy={onCopy} onDelete={onDelete} onRun={vi.fn()} onReplaceMedia={vi.fn()} onToggleFreeResize={vi.fn()} />);
    expect(screen.getByTestId('workflow-node-toolbar')).toHaveClass('isl-shell');
    fireEvent.click(screen.getByRole('button', { name: '复制节点' }));
    fireEvent.click(screen.getByRole('button', { name: '删除节点' }));
    expect(onCopy).toHaveBeenCalledWith(['image']);
    expect(onDelete).toHaveBeenCalledWith(['image']);
  });

  it('isolates pointer and wheel events at the overlay boundary', () => {
    const pointer = vi.fn();
    const wheel = vi.fn();
    render(<div onPointerDown={pointer} onWheel={wheel}><WorkflowNodeToolbar nodes={[node]} onCopy={vi.fn()} onDelete={vi.fn()} /></div>);
    const overlay = screen.getByTestId('workflow-node-toolbar');
    fireEvent.pointerDown(overlay);
    fireEvent.wheel(overlay);
    expect(pointer).not.toHaveBeenCalled();
    expect(wheel).not.toHaveBeenCalled();
  });

  it('binds prompt mode and model changes to canonical workflow metadata', () => {
    const onChange = vi.fn();
    render(<WorkflowNodePromptBar
      node={node}
      nodes={[node, createWorkflowNode('other', 'text', { x: 0, y: 0 }, { content: '参考文案' })]}
      t={t}
      theme="light"
      language="zho"
      userApiKeys={[]}
      modelPreference={{ textModel: '', imageModel: 'image-model', videoModel: 'video-model' }}
      dynamicModelOptions={{ text: [], image: ['image-model'], video: ['video-model'] }}
      onChange={onChange}
      onRun={vi.fn()}
    />);
    expect(screen.getByTestId('workflow-node-prompt-bar')).toBeInTheDocument();
    expect(screen.getByText('初始提示词')).toBeInTheDocument();
  });
});
