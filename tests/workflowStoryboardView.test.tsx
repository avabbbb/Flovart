import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { buildStoryboardView } from '../components/workflow/productionBible';
import { WorkflowStoryboardView, WorkflowViewSwitch } from '../components/workflow/WorkflowStoryboardView';
import type { WorkflowNode } from '../components/workflow/types';

afterEach(cleanup);

const node = (id: string, type: string, patch: Partial<WorkflowNode>, metadata: Record<string, unknown> = {}) =>
  ({ ...createWorkflowNode(id, type as never, { x: 0, y: 0 }, metadata), ...patch }) as WorkflowNode;

describe('WorkflowStoryboardView', () => {
  const view = buildStoryboardView({
    nodes: [
      node('hero', 'image', { title: '主角', anchor: { kind: 'character', approved: true } }),
      node('v1', 'video', { title: '镜头 1', shot: { index: 1, durationSec: 3 } }, { prompt: '走', href: 'https://x/1.mp4' }),
      node('v2', 'video', { title: '镜头 2', shot: { index: 2, durationSec: 2 } }, { prompt: '跑', href: 'https://x/2.mp4' }),
    ],
    connections: [{ id: 'c', fromNodeId: 'hero', toNodeId: 'v1' }],
  });

  it('opens the clicked shot on the canvas, references to Agent, and merges in shot order', () => {
    const onOpenNode = vi.fn();
    const onReference = vi.fn();
    const onMerge = vi.fn();
    render(<WorkflowStoryboardView view={view} onOpenNode={onOpenNode} onReference={onReference} onMerge={onMerge} />);
    expect(screen.getByText('A01')).toBeTruthy();
    fireEvent.click(screen.getByTestId('storyboard-row-2'));
    expect(onOpenNode).toHaveBeenCalledWith('v2');
    fireEvent.click(screen.getByLabelText('引用到 Agent #1'));
    expect(onReference).toHaveBeenCalledWith(['v1']);
    expect(onOpenNode).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('storyboard-merge'));
    expect(onMerge).toHaveBeenCalledWith(['v1', 'v2']);
  });

  it('switches between workflow and storyboard', () => {
    const onChange = vi.fn();
    render(<WorkflowViewSwitch value="workflow" onChange={onChange} shotCount={2} />);
    fireEvent.click(screen.getByRole('tab', { name: '故事板 · 2' }));
    expect(onChange).toHaveBeenCalledWith('storyboard');
  });
});
