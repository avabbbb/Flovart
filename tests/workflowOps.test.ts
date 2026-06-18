import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { applyWorkflowOps, validateWorkflowConnection } from '../components/workflow/ops';
import type { WorkflowSnapshot } from '../components/workflow/types';

const snapshot = (): WorkflowSnapshot => ({
  projectId: 'project-1',
  title: 'Workflow',
  nodes: [
    { id: 'a', type: 'text', title: 'A', position: { x: 0, y: 0 }, width: 320, height: 200, metadata: { content: 'A' } },
    { id: 'b', type: 'config', title: 'B', position: { x: 420, y: 0 }, width: 340, height: 240, metadata: {} },
    { id: 'c', type: 'image', title: 'C', position: { x: 840, y: 0 }, width: 340, height: 240, metadata: {} },
  ],
  connections: [],
  selectedNodeIds: [],
  viewport: { x: 0, y: 0, k: 1 },
});

describe('applyWorkflowOps', () => {
  it('creates the canonical audio node type', () => {
    const audio = createWorkflowNode('audio-1', 'audio', { x: 20, y: 40 }, {
      storageKey: 'workflow/media/audio-1',
      mimeType: 'audio/mpeg',
      durationMs: 4200,
    });

    expect(audio).toMatchObject({
      type: 'audio',
      title: '音频',
      metadata: { storageKey: 'workflow/media/audio-1', durationMs: 4200 },
    });
  });

  it('returns explicit reasons for invalid connections', () => {
    const connected = {
      ...snapshot(),
      connections: [
        { id: 'ab', fromNodeId: 'a', toNodeId: 'b' },
        { id: 'bc', fromNodeId: 'b', toNodeId: 'c' },
      ],
    };
    const withSecondConfig = {
      ...snapshot(),
      nodes: [...snapshot().nodes, createWorkflowNode('config-2', 'config', { x: 0, y: 400 })],
    };

    expect(validateWorkflowConnection(snapshot(), 'missing', 'a')).toEqual({ ok: false, reason: '起始节点不存在' });
    expect(validateWorkflowConnection(snapshot(), 'a', 'missing')).toEqual({ ok: false, reason: '目标节点不存在' });
    expect(validateWorkflowConnection(snapshot(), 'a', 'a')).toEqual({ ok: false, reason: '不能连接节点自身' });
    expect(validateWorkflowConnection(connected, 'a', 'b')).toEqual({ ok: false, reason: '节点之间已存在连接' });
    expect(validateWorkflowConnection(connected, 'c', 'a')).toEqual({ ok: false, reason: '连接会形成循环' });
    expect(validateWorkflowConnection(withSecondConfig, 'b', 'config-2')).toEqual({ ok: false, reason: '生成配置节点之间不能连接' });
  });

  it('creates, connects, and selects a node atomically', () => {
    const source = createWorkflowNode('source', 'image', { x: 0, y: 0 });
    const created = createWorkflowNode('created', 'video', { x: 500, y: 0 });
    const initial = { ...snapshot(), nodes: [source] };
    const result = applyWorkflowOps(initial, [
      { type: 'create_connected_node', fromNodeId: source.id, node: created },
    ]);

    expect(result.snapshot.nodes).toContainEqual(created);
    expect(result.snapshot.connections[0]).toMatchObject({ fromNodeId: source.id, toNodeId: created.id });
    expect(result.snapshot.selectedNodeIds).toEqual([created.id]);
  });

  it('does not add any state when create-and-connect validation fails', () => {
    const created = createWorkflowNode('created', 'video', { x: 500, y: 0 });
    const initial = snapshot();
    const result = applyWorkflowOps(initial, [
      { type: 'create_connected_node', fromNodeId: 'missing', node: created },
    ]);

    expect(result.snapshot.nodes).toEqual(initial.nodes);
    expect(result.snapshot.connections).toEqual(initial.connections);
    expect(result.snapshot.selectedNodeIds).toEqual(initial.selectedNodeIds);
  });

  it('removes incident connections when deleting a node', () => {
    const result = applyWorkflowOps(
      {
        ...snapshot(),
        connections: [
          { id: 'ab', fromNodeId: 'a', toNodeId: 'b' },
          { id: 'bc', fromNodeId: 'b', toNodeId: 'c' },
        ],
        selectedNodeIds: ['b'],
      },
      [{ type: 'delete_nodes', ids: ['b'] }],
    );

    expect(result.snapshot.nodes.map(node => node.id)).toEqual(['a', 'c']);
    expect(result.snapshot.connections).toEqual([]);
    expect(result.snapshot.selectedNodeIds).toEqual([]);
  });

  it('returns generation intents without mutating node content', () => {
    const before = snapshot();
    const result = applyWorkflowOps(before, [{ type: 'run_generation', nodeId: 'b' }]);

    expect(result.snapshot.nodes).toEqual(before.nodes);
    expect(result.runRequests).toEqual([{ nodeId: 'b' }]);
  });
});
