import { describe, expect, it } from 'vitest';
import { createExecutionPlan } from '../services/workflowEngine';
import type { WorkflowEdge, WorkflowNode } from '../components/nodeflow/types';

const nodes: WorkflowNode[] = [
  { id: 'prompt', kind: 'prompt', x: 0, y: 0 },
  { id: 'template', kind: 'template', x: 100, y: 0 },
  { id: 'llm', kind: 'llm', x: 200, y: 0 },
  { id: 'branch', kind: 'template', x: 100, y: 120 },
  { id: 'preview', kind: 'preview', x: 300, y: 0 },
  { id: 'save', kind: 'saveToCanvas', x: 400, y: 0 },
  { id: 'isolated', kind: 'imageGen', x: 600, y: 0 },
];

const edges: WorkflowEdge[] = [
  { id: 'e1', fromNode: 'prompt', fromPort: 'text', toNode: 'template', toPort: 'input' },
  { id: 'e2', fromNode: 'template', fromPort: 'output', toNode: 'llm', toPort: 'input' },
  { id: 'e3', fromNode: 'branch', fromPort: 'output', toNode: 'llm', toPort: 'text' },
  { id: 'e4', fromNode: 'llm', fromPort: 'text', toNode: 'preview', toPort: 'input' },
  { id: 'e5', fromNode: 'preview', fromPort: 'result', toNode: 'save', toPort: 'input' },
];

describe('createExecutionPlan', () => {
  it('includes only the selected node and its required upstream closure for node execution', () => {
    const plan = createExecutionPlan(nodes, edges, 'node', 'llm');
    expect(plan.nodes.map((node) => node.id)).toEqual(['prompt', 'template', 'llm']);
    expect(plan.edges.map((edge) => edge.id)).toEqual(['e1', 'e2']);
    expect(plan.includedNodeIds.has('preview')).toBe(false);
    expect(plan.includedNodeIds.has('isolated')).toBe(false);
  });

  it('includes downstream targets and all dependencies for execute from here', () => {
    const plan = createExecutionPlan(nodes, edges, 'from-here', 'template');
    expect(plan.nodes.map((node) => node.id)).toEqual(['prompt', 'template', 'llm', 'preview']);
    expect(plan.edges.map((edge) => edge.id)).toEqual(['e1', 'e2', 'e4']);
    expect(plan.includedNodeIds.has('isolated')).toBe(false);
  });

  it('normalizes legacy workflow ports and drops unusable edges before planning', () => {
    const plan = createExecutionPlan(nodes, [
      ...edges,
      { id: 'missing', fromNode: 'missing', fromPort: 'text', toNode: 'llm', toPort: 'input' },
      { id: 'bad-type', fromNode: 'prompt', fromPort: 'text', toNode: 'isolated', toPort: 'image' },
    ], 'workflow');

    expect(plan.edges.map((edge) => edge.id)).toEqual(['e1', 'e2', 'e4']);
    expect(plan.edges.find((edge) => edge.id === 'e1')).toMatchObject({ toPort: 'var1' });
    expect(plan.edges.find((edge) => edge.id === 'e2')).toMatchObject({ fromPort: 'text' });
  });
});
