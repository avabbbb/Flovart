import { describe, expect, it } from 'vitest';
import { documentOperationsArg } from '../services/workflowDispatcher';
import { applyWorkflowOps } from '../components/workflow/ops';

describe('update_node guards', () => {
  it('accepts nodeId as an alias for id', () => {
    const [op] = documentOperationsArg([{ type: 'update_node', nodeId: 'node-1', metadata: { prompt: '新提示词' } }]);
    expect(op).toMatchObject({ type: 'update_node', id: 'node-1', metadata: { prompt: '新提示词' } });
    expect(op).not.toHaveProperty('nodeId');
  });

  it('prefers an explicit id over nodeId', () => {
    const [op] = documentOperationsArg([{ type: 'update_node', id: 'a', nodeId: 'b', patch: { title: 'x' } }]);
    expect(op).toMatchObject({ id: 'a' });
  });

  it('throws a clear error when update_node has no node id', () => {
    expect(() => documentOperationsArg([{ type: 'update_node', metadata: { prompt: 'x' } }])).toThrow('operations[0] update_node 缺少节点 id');
  });

  it('rejects update_node for a node that does not exist', () => {
    const result = applyWorkflowOps({ nodes: [], connections: [], selectedNodeIds: [] } as never, [
      { type: 'update_node', id: 'ghost', metadata: { prompt: 'x' } },
    ] as never);
    expect(JSON.stringify(result)).toContain('节点不存在：ghost');
  });

  it('writes metadata.prompt on an existing node via the nodeId alias', () => {
    const node = { id: 'n1', type: 'text', title: '文本', position: { x: 0, y: 0 }, width: 320, height: 200, metadata: { prompt: '旧' } };
    const ops = documentOperationsArg([{ type: 'update_node', nodeId: 'n1', metadata: { prompt: '新' } }]);
    const result = applyWorkflowOps({ nodes: [node], connections: [], selectedNodeIds: [] } as never, ops as never);
    expect(result.snapshot.nodes[0].metadata.prompt).toBe('新');
  });
});
