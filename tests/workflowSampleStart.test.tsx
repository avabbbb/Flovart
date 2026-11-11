import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { buildSampleCanvasSeed } from '../components/workflow/templates';
import { WorkflowStartScreen } from '../components/workflow/WorkflowStartScreen';

describe('sample canvas from the start screen', () => {
  it('builds a labeled sample: one script note plus three independent shots', () => {
    const seed = buildSampleCanvasSeed('zho');
    const script = seed.nodes.find(node => node.type === 'text');
    const shots = seed.nodes.filter(node => node.type === 'video');
    expect(script?.title).toBe('示例 · 脚本');
    expect(shots.map(node => node.title)).toEqual(['示例 · 镜头 1', '示例 · 镜头 2', '示例 · 镜头 3']);
    expect(shots.every(node => typeof node.metadata.prompt === 'string' && node.metadata.prompt.length > 0)).toBe(true);
    expect(seed.connections).toEqual([]);
    expect(new Set(shots.map(shot => shot.position.x)).size).toBe(3);
  });

  it('offers the sample on the first screen, separate from a blank canvas', () => {
    const onSample = vi.fn();
    const onBlank = vi.fn();
    render(<WorkflowStartScreen language="zho" onStart={() => undefined} onBlank={onBlank} onSample={onSample} />);
    fireEvent.click(screen.getByTestId('workflow-open-sample'));
    expect(onSample).toHaveBeenCalledTimes(1);
    expect(onBlank).not.toHaveBeenCalled();
  });
});
