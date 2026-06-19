import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { WorkflowNode } from '../components/workflow/WorkflowNode';
import { WorkflowImageToolDialogs } from '../components/workflow/WorkflowImageToolDialogs';

const image = createWorkflowNode('image', 'image', { x: 0, y: 0 }, { href: 'data:image/png;base64,AA==', mimeType: 'image/png', filters: { brightness: 120 } });

describe('workflow image tools UI', () => {
  it('renders persisted filters on image nodes', () => {
    render(<WorkflowNode node={image} selected onPointerDown={vi.fn()} onConnectStart={vi.fn()} onResizeStart={vi.fn()} onChangeText={vi.fn()} onChangeMetadata={vi.fn()} onRun={vi.fn()} onContextMenu={vi.fn()} onReplaceMedia={vi.fn()} onRemoveMedia={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveStyle({ filter: 'brightness(1.2)' });
  });

  it('opens crop, filter, upscale, outpaint, mask and split interfaces with real confirmations', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<WorkflowImageToolDialogs tool={{ kind: 'crop', nodeId: 'image' }} node={image} mediaUrl={image.metadata.href!} busy={false} error={null} onClose={vi.fn()} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('button', { name: '应用裁剪' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ kind: 'crop', crop: expect.any(Object) }));
    for (const [kind, action] of [['filter', '完成调色'], ['upscale', '开始放大'], ['outpaint', '开始扩展'], ['mask', 'AI 修改'], ['split', '拆分图层']] as const) {
      rerender(<WorkflowImageToolDialogs tool={{ kind, nodeId: 'image' }} node={image} mediaUrl={image.metadata.href!} busy={false} error={null} onClose={vi.fn()} onConfirm={onConfirm} />);
      expect(screen.getByRole('button', { name: action })).toBeInTheDocument();
    }
  });
});
