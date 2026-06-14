import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { WorkflowEdge, WorkflowNode, WorkflowViewport } from '../components/nodeflow/types';
import { WorkflowKonvaShell } from '../components/workflow/WorkflowKonvaShell';

vi.mock('react-konva', () => {
  const Mock = (name: string) => ({ children, ...props }: any) => {
    const domProps = Object.fromEntries(
      Object.entries(props).filter(([key]) => (
        key.startsWith('data-')
        || key === 'width'
        || key === 'height'
        || key === 'x'
        || key === 'y'
        || key === 'scaleX'
        || key === 'scaleY'
      )),
    );
    return (
      <div data-konva={name} {...domProps}>
      {children}
      </div>
    );
  };
  return {
    Stage: Mock('Stage'),
    Layer: Mock('Layer'),
    Group: Mock('Group'),
    Rect: Mock('Rect'),
    Text: Mock('Text'),
    Circle: Mock('Circle'),
    Path: Mock('Path'),
  };
});

const nodes: WorkflowNode[] = [
  { id: 'prompt', kind: 'prompt', x: 100, y: 120, config: { label: 'Prompt', prompt: 'make @Hero move' } },
  { id: 'video', kind: 'videoGen', x: 520, y: 120, config: { label: 'Video', model: 'seedance-2.0' } },
];

const edges: WorkflowEdge[] = [
  { id: 'edge-1', fromNode: 'prompt', fromPort: 'text', toNode: 'video', toPort: 'image' },
];

const viewport: WorkflowViewport = { x: 12, y: 24, scale: 0.75 };

describe('WorkflowKonvaShell', () => {
  it('renders workflow nodes and edges through Konva primitives', () => {
    render(
      <WorkflowKonvaShell
        width={1200}
        height={700}
        nodes={nodes}
        edges={edges}
        groups={[]}
        viewport={viewport}
        selectedNodeIds={['video']}
      />,
    );

    expect(screen.getByTestId('workflow-konva-stage').getAttribute('width')).toBe('1200');
    expect(screen.getByTestId('workflow-konva-world').getAttribute('x')).toBe('12');
    expect(screen.getByTestId('workflow-konva-world').getAttribute('scaleX')).toBe('0.75');
    expect(screen.getByTestId('workflow-konva-node-prompt')).not.toBeNull();
    expect(screen.getByTestId('workflow-konva-node-video')).not.toBeNull();
    expect(screen.getByTestId('workflow-konva-edge-edge-1')).not.toBeNull();
  });

  it('keeps invalid edges out of the Konva layer', () => {
    render(
      <WorkflowKonvaShell
        width={800}
        height={500}
        nodes={nodes}
        edges={[...edges, { id: 'stale', fromNode: 'missing', fromPort: 'text', toNode: 'video', toPort: 'image' }]}
        groups={[]}
        viewport={viewport}
        selectedNodeIds={[]}
      />,
    );

    expect(screen.getByTestId('workflow-konva-edge-edge-1')).not.toBeNull();
    expect(screen.queryByTestId('workflow-konva-edge-stale')).toBeNull();
  });
});
