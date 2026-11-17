import { describe, expect, it } from 'vitest';
import { migrateLegacyOperationNodes, revertWorkflowDirectOutputMigration } from '../components/workflow/directOutputMigration';
import { migrateWorkflowProject } from '../components/workflow/migrations';
import type { WorkflowConnection, WorkflowNode } from '../components/workflow/types';

const recipe = (sourceNodeId: string) => ({
  capabilityId: 'image.crop@1',
  version: 1,
  promptDocument: { text: '' },
  parameters: { x: 0, y: 0, width: 10, height: 10 },
  inputBindings: [{ id: 'conn-in', sourceNodeId, role: 'source_image', order: 0, objectVersion: 1 }],
  recipeHash: 'h1',
  objectVersion: 1,
  updatedAt: '2026-11-01T00:00:00.000Z',
});

function media(id: string, storageKey: string, extra: Partial<WorkflowNode['metadata']> = {}): WorkflowNode {
  return { id, type: 'image', title: id, position: { x: 0, y: 0 }, width: 300, height: 200, isVisible: true, isLocked: false, metadata: { status: 'success', storageKey, mimeType: 'image/png', ...extra } } as WorkflowNode;
}

function legacyGraph() {
  const take = (id: string, outputNodeIds: string[]) => ({ id, status: 'success', recipeHash: 'h1', createdAt: '2026-11-01T00:00:00.000Z', completedAt: '2026-11-01T00:00:01.000Z', snapshot: { id: 's-' + id }, outputNodeIds });
  const operation: WorkflowNode = {
    id: 'op', type: 'operation', title: '裁剪图片', position: { x: 400, y: 0 }, width: 240, height: 156, isVisible: true, isLocked: false,
    metadata: {
      status: 'success',
      prompt: '',
      config: { mode: 'image', operationParameters: { x: 0 } },
      operation: { capabilityId: 'image.crop@1', recipe: recipe('src'), takes: [take('t1', ['out-1']), take('t2', ['out-2'])], selectedTakeId: 't2', selectedTakeSource: 'explicit' },
    },
  } as unknown as WorkflowNode;
  const nodes: WorkflowNode[] = [
    media('src', 'k-src'),
    operation,
    media('out-1', 'k-1', { sourceOperationNodeId: 'op', operationTakeId: 't1' }),
    media('out-2', 'k-2', { sourceOperationNodeId: 'op', operationTakeId: 't2' }),
    media('down', 'k-down'),
  ];
  const connections: WorkflowConnection[] = [
    { id: 'conn-in', fromNodeId: 'src', toNodeId: 'op', kind: 'operation-input', role: 'source_image', order: 0 },
    { id: 'c-o1', fromNodeId: 'op', toNodeId: 'out-1', kind: 'operation-output', role: 'result_image', order: 0 },
    { id: 'c-o2', fromNodeId: 'op', toNodeId: 'out-2', kind: 'operation-output', role: 'result_image', order: 0 },
    { id: 'c-down', fromNodeId: 'out-2', toNodeId: 'down' },
  ];
  return { nodes, connections };
}

describe('v6 direct-output migration (no operation middle node)', () => {
  it('moves the operation record onto the selected result node and wires inputs directly', () => {
    const { nodes, connections } = legacyGraph();
    const migrated = migrateLegacyOperationNodes(nodes, connections, '2026-11-18T00:00:00.000Z');
    expect(migrated.nodes.some(node => node.type === 'operation')).toBe(false);
    expect(migrated.nodes.map(node => node.id).sort()).toEqual(['down', 'out-1', 'out-2', 'src']);
    const result = migrated.nodes.find(node => node.id === 'out-2')!;
    expect(result.metadata.operation?.capabilityId).toBe('image.crop@1');
    expect(result.metadata.operation?.selectedTakeId).toBe('t2');
    expect(result.metadata.sourceOperationNodeId).toBeUndefined();
    expect(result.metadata.storageKey).toBe('k-2');
    // 旧版本可在结果节点上切换：t1 的媒体写进了 take.outputMedia。
    const t1 = result.metadata.operation!.takes.find(take => take.id === 't1')!;
    expect(t1.outputMedia?.storageKey).toBe('k-1');
    expect(t1.outputNodeIds[0]).toBe('out-2');
    // 输入直连结果；其它输出改为输入→输出；下游不变。
    expect(migrated.connections.find(item => item.id === 'conn-in')).toMatchObject({ fromNodeId: 'src', toNodeId: 'out-2', kind: 'operation-input' });
    expect(migrated.connections.find(item => item.id === 'c-o1')).toMatchObject({ fromNodeId: 'src', toNodeId: 'out-1', kind: 'operation-output' });
    expect(migrated.connections.some(item => item.id === 'c-o2')).toBe(false);
    expect(migrated.connections.find(item => item.id === 'c-down')).toMatchObject({ fromNodeId: 'out-2', toNodeId: 'down' });
    expect(migrated.nodes.find(node => node.id === 'out-1')!.metadata.sourceOperationNodeId).toBe('out-2');
    expect(migrated.renamed.get('op')).toBe('out-2');
  });

  it('converts an operation without outputs in place (same id, same connections)', () => {
    const { nodes, connections } = legacyGraph();
    const bare = nodes.filter(node => !node.id.startsWith('out')).map(node => node.id === 'op'
      ? { ...node, metadata: { ...node.metadata, status: 'idle', operation: { ...node.metadata.operation!, takes: [], selectedTakeId: undefined } } } as WorkflowNode
      : node);
    const migrated = migrateLegacyOperationNodes(bare, connections.filter(item => item.id === 'conn-in'));
    const result = migrated.nodes.find(node => node.id === 'op')!;
    expect(result.type).toBe('image');
    expect(result.metadata.operation?.capabilityId).toBe('image.crop@1');
    expect(migrated.connections).toEqual([expect.objectContaining({ id: 'conn-in', fromNodeId: 'src', toNodeId: 'op' })]);
  });

  it('can be reverted to the exact pre-migration structure', () => {
    const { nodes, connections } = legacyGraph();
    const migrated = migrateLegacyOperationNodes(nodes, connections);
    const reverted = revertWorkflowDirectOutputMigration(migrated);
    const byId = (list: { id: string }[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
    expect(byId(reverted.nodes)).toEqual(byId(nodes));
    expect(byId(reverted.connections)).toEqual(byId(connections));
  });

  it('runs on project load, is idempotent and keeps selection on the result', () => {
    const { nodes, connections } = legacyGraph();
    const project = { id: 'p', title: 'p', nodes, connections, selectedNodeIds: ['op'], viewport: { x: 0, y: 0, k: 1 } };
    const once = migrateWorkflowProject(project, '2026-11-18T00:00:00.000Z');
    expect(once.nodes.some(node => node.type === 'operation')).toBe(false);
    expect(once.selectedNodeIds).toEqual(['out-2']);
    const twice = migrateWorkflowProject(once, '2026-11-18T00:00:00.000Z');
    expect(twice.nodes).toEqual(once.nodes);
    expect(twice.connections).toEqual(once.connections);
  });
});
