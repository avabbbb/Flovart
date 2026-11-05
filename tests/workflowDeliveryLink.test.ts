import { describe, expect, it } from 'vitest';
import { parseWorkflowDeliveryLink, stripWorkflowDeliveryLink } from '../components/workflow/deliveryLink';
import { tagWorkflowNodeOrigin } from '../services/workflowDispatcher';
import type { WorkflowNode } from '../components/workflow/types';

const makeNode = (id: string, metadata: WorkflowNode['metadata'] = {}): WorkflowNode => (
  { id, type: 'image', title: id, position: { x: 0, y: 0 }, width: 240, height: 240, metadata } as unknown as WorkflowNode
);

describe('workflow delivery link', () => {
  it('parses project and focus ids from the hash route', () => {
    expect(parseWorkflowDeliveryLink('#/app?project=p1&focus=n1%2Cn2')).toEqual({ projectId: 'p1', focusNodeIds: ['n1', 'n2'] });
    expect(parseWorkflowDeliveryLink('#/app?project=p1')).toEqual({ projectId: 'p1', focusNodeIds: [] });
    expect(parseWorkflowDeliveryLink('#/app?focus=n1')).toBeNull();
    expect(parseWorkflowDeliveryLink('#/app?project=bad%20id')).toBeNull();
    expect(parseWorkflowDeliveryLink('#/app')).toBeNull();
  });

  it('strips only delivery params', () => {
    expect(stripWorkflowDeliveryLink('#/app?project=p1&focus=n1&token=t')).toBe('#/app?token=t');
    expect(stripWorkflowDeliveryLink('#/app?project=p1')).toBe('#/app');
  });
});

describe('workflow node origin', () => {
  it('tags new nodes by command source without overriding explicit origin', () => {
    const node = makeNode('n1');
    const explicit = makeNode('n2', { origin: 'user' });
    const [agentOp, keptOp, connectOp] = tagWorkflowNodeOrigin([
      { type: 'add_node', node },
      { type: 'add_node', node: explicit },
      { type: 'connect_nodes', fromNodeId: 'n1', toNodeId: 'n2' },
    ], 'agent');
    expect(agentOp).toMatchObject({ node: { metadata: { origin: 'agent' } } });
    expect(keptOp).toMatchObject({ node: { metadata: { origin: 'user' } } });
    expect(connectOp).toEqual({ type: 'connect_nodes', fromNodeId: 'n1', toNodeId: 'n2' });
    expect(tagWorkflowNodeOrigin([{ type: 'add_node', node }], 'ui')[0]).toMatchObject({ node: { metadata: { origin: 'user' } } });
  });
});
