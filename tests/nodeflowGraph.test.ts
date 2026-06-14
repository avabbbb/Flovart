import { describe, expect, it } from 'vitest';

import { canConnectEdge, getBezierPath, normalizeWorkflowEdges } from '../components/nodeflow/graph';
import type { WorkflowNode } from '../components/nodeflow/types';

const node = (id: string, kind: WorkflowNode['kind']): WorkflowNode => ({
  id,
  kind,
  x: 0,
  y: 0,
});

describe('nodeflow graph helpers', () => {
  it('allows result and any ports to receive concrete media values', () => {
    expect(canConnectEdge(node('image', 'loadImage'), 'image', node('preview', 'preview'), 'result')).toBe(true);
    expect(canConnectEdge(node('video', 'loadVideo'), 'video', node('save', 'saveToCanvas'), 'result')).toBe(true);
    expect(canConnectEdge(node('prompt', 'prompt'), 'text', node('http', 'httpRequest'), 'input')).toBe(true);
    expect(canConnectEdge(node('imageGen', 'imageGen'), 'image', node('videoGen', 'videoGen'), 'image')).toBe(true);
  });

  it('still blocks incompatible concrete ports', () => {
    expect(canConnectEdge(node('prompt', 'prompt'), 'text', node('imageGen', 'imageGen'), 'image')).toBe(false);
    expect(canConnectEdge(node('video', 'loadVideo'), 'video', node('imageGen', 'imageGen'), 'image')).toBe(false);
  });

  it('uses adaptive bezier handles instead of a fixed curve offset', () => {
    expect(getBezierPath({ x: 0, y: 0 }, { x: 60, y: 30 })).toBe('M 0 0 C 48 0, 12 30, 60 30');
    expect(getBezierPath({ x: 0, y: 0 }, { x: 800, y: 30 })).toBe('M 0 0 C 150 0, 650 30, 800 30');
  });

  it('normalizes imported workflow edges against node ports and drops invalid connections', () => {
    const nodes: WorkflowNode[] = [
      node('prompt', 'prompt'),
      node('template', 'template'),
      node('llm', 'llm'),
      node('image', 'imageGen'),
    ];
    const normalized = normalizeWorkflowEdges(nodes, [
      { id: 'legacy_input', fromNode: 'prompt', fromPort: 'text', toNode: 'template', toPort: 'input' },
      { id: 'legacy_output', fromNode: 'template', fromPort: 'output', toNode: 'llm', toPort: 'input' },
      { id: 'missing_node', fromNode: 'missing', fromPort: 'text', toNode: 'llm', toPort: 'input' },
      { id: 'bad_type', fromNode: 'prompt', fromPort: 'text', toNode: 'image', toPort: 'image' },
    ]);

    expect(normalized).toEqual([
      { id: 'legacy_input', fromNode: 'prompt', fromPort: 'text', toNode: 'template', toPort: 'var1' },
      { id: 'legacy_output', fromNode: 'template', fromPort: 'text', toNode: 'llm', toPort: 'text' },
    ]);
  });
});
