import { nanoid } from 'nanoid';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { applyWorkflowOps, validateWorkflowConnection } from '../components/workflow/ops';
import type { WorkflowSnapshot } from '../components/workflow/types';

vi.mock('nanoid', () => ({ nanoid: vi.fn() }));

const mockedNanoid = vi.mocked(nanoid);

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
  beforeEach(() => {
    mockedNanoid.mockReset();
    mockedNanoid.mockReturnValue('connection-generated');
  });

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
    expect(result.rejections).toEqual([]);
  });

  it('does not add any state and reports why create-and-connect validation failed', () => {
    const created = createWorkflowNode('created', 'video', { x: 500, y: 0 });
    const initial = snapshot();
    const result = applyWorkflowOps(initial, [
      { type: 'create_connected_node', fromNodeId: 'missing', node: created },
    ]);

    expect(result.snapshot.nodes).toEqual(initial.nodes);
    expect(result.snapshot.connections).toEqual(initial.connections);
    expect(result.snapshot.selectedNodeIds).toEqual(initial.selectedNodeIds);
    expect(result.rejections).toEqual([
      { opIndex: 0, opType: 'create_connected_node', reason: '起始节点不存在' },
    ]);
  });

  it('reports rejected connection operations with their operation index', () => {
    const result = applyWorkflowOps(snapshot(), [
      { type: 'select_nodes', ids: ['a'] },
      { type: 'connect_nodes', fromNodeId: 'a', toNodeId: 'a' },
    ]);

    expect(result.rejections).toEqual([
      { opIndex: 1, opType: 'connect_nodes', reason: '不能连接节点自身' },
    ]);
  });

  it('rejects duplicate node and explicit connection ids with reasons', () => {
    const initial = {
      ...snapshot(),
      connections: [{ id: 'connection-taken', fromNodeId: 'a', toNodeId: 'b' }],
    };
    const result = applyWorkflowOps(initial, [
      { type: 'create_connected_node', fromNodeId: 'a', node: createWorkflowNode('a', 'video', { x: 500, y: 0 }) },
      { type: 'connect_nodes', id: 'connection-taken', fromNodeId: 'b', toNodeId: 'c' },
    ]);

    expect(result.snapshot.nodes).toEqual(initial.nodes);
    expect(result.snapshot.connections).toEqual(initial.connections);
    expect(result.rejections).toEqual([
      { opIndex: 0, opType: 'create_connected_node', reason: '节点 ID 已存在' },
      { opIndex: 1, opType: 'connect_nodes', reason: '连接 ID 已存在' },
    ]);
  });

  it('regenerates a create-and-connect id until it is unique', () => {
    mockedNanoid.mockReturnValueOnce('connection-taken').mockReturnValueOnce('connection-unique');
    const source = createWorkflowNode('source', 'image', { x: 0, y: 0 });
    const created = createWorkflowNode('created', 'audio', { x: 500, y: 0 });
    const initial = {
      ...snapshot(),
      nodes: [source],
      connections: [{ id: 'connection-taken', fromNodeId: 'legacy-a', toNodeId: 'legacy-b' }],
    };
    const result = applyWorkflowOps(initial, [
      { type: 'create_connected_node', fromNodeId: source.id, node: created },
    ]);

    expect(result.snapshot.connections.at(-1)?.id).toBe('connection-unique');
    expect(mockedNanoid).toHaveBeenCalledTimes(2);
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
