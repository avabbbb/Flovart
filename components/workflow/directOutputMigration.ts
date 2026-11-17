import { getWorkflowOperationCapability } from './operationRegistry';
import type {
  WorkflowConnection,
  WorkflowNode,
  WorkflowNodeMetadata,
  WorkflowOperationRecord,
  WorkflowOperationTake,
  WorkflowOperationTakeMedia,
} from './types';

/**
 * v6：去掉 operation 中间节点，输入直接连到结果节点。
 *
 * 旧画布里 `type:'operation'` 节点 O 的生成记录（能力、配方、takes、选中）挪到它的结果节点 R 上：
 * - O 有可用结果节点 R（选中 / 最新成功 take 的输出，且 R 自己没有生成记录）：记录并入 R，O 的输入线改连 R，
 *   其余输出改为“首个输入 → 输出”的 operation-output 线、sourceOperationNodeId 指回 R，删除 O。
 *   每个成功 take 若还能找到输出媒体，就写进 take.outputMedia，并把 R 加进 outputNodeIds，旧版本可在 R 上切换。
 * - 否则 O 原位变成结果类型（image / video / audio），同 id、同连线；选中 take 的输出媒体复制到 O 上显示。
 * 迁移不删除任何结果节点；原 O 整份保存在结果节点的 metadata.legacyOperationNode，
 * revertWorkflowDirectOutputMigration 可逐项目还原。
 */

export interface WorkflowLegacyOperationSnapshot {
  /** 迁移前的 operation 节点（含完整生成记录）。 */
  node: WorkflowNode;
  /** 迁移前与 O 相关的全部连线（进 O、出 O）。 */
  connections: WorkflowConnection[];
  /** 并入时结果节点 R 迁移前的样子（原位转换时为空）。 */
  resultNodeBefore?: WorkflowNode;
  /** 迁移时把 sourceOperationNodeId 从 O 改到 R 的输出节点。 */
  reownedNodeIds: string[];
  migratedAt: string;
}

type ResultType = 'image' | 'video' | 'audio';

const MEDIA_KEYS = ['storageKey', 'mimeType', 'name', 'bytes', 'naturalWidth', 'naturalHeight', 'posterStorageKey', 'durationMs'] as const;

function resultTypeOf(record: WorkflowOperationRecord | undefined): ResultType {
  if (!record) return 'image';
  try {
    return getWorkflowOperationCapability(record.capabilityId).outputRoles[0]?.nodeType || 'image';
  } catch {
    return 'image';
  }
}

const TAKE_MEDIA_KEYS = ['storageKey', 'mimeType', 'name', 'bytes', 'naturalWidth', 'naturalHeight', 'posterStorageKey'] as const;

// 不引用 operations.ts：它依赖 store，而 store 的持久化水合会调用本迁移（避免循环依赖）。
function mediaOf(node: WorkflowNode | undefined): WorkflowOperationTakeMedia | undefined {
  if (!node?.metadata.storageKey) return undefined;
  const source = node.metadata as unknown as Record<string, unknown>;
  const media: Record<string, unknown> = {};
  for (const key of TAKE_MEDIA_KEYS) if (source[key] !== undefined) media[key] = source[key];
  return media as unknown as WorkflowOperationTakeMedia;
}

function copyMedia(node: WorkflowNode): Partial<WorkflowNodeMetadata> {
  const source = node.metadata as unknown as Record<string, unknown>;
  const media: Record<string, unknown> = {};
  for (const key of MEDIA_KEYS) if (source[key] !== undefined) media[key] = source[key];
  return media as Partial<WorkflowNodeMetadata>;
}

function successTakes(record: WorkflowOperationRecord): WorkflowOperationTake[] {
  return (record.takes || []).filter(take => take.status === 'success');
}

function preferredTakeOrder(record: WorkflowOperationRecord): WorkflowOperationTake[] {
  const successes = successTakes(record);
  const selected = successes.find(take => take.id === record.selectedTakeId);
  return [...(selected ? [selected] : []), ...[...successes].reverse().filter(take => take !== selected)];
}

export function hasLegacyOperationNodes(nodes: readonly WorkflowNode[]): boolean {
  return nodes.some(node => node.type === 'operation');
}

export function migrateLegacyOperationNodes(
  inputNodes: WorkflowNode[],
  inputConnections: WorkflowConnection[],
  now = new Date().toISOString(),
): { nodes: WorkflowNode[]; connections: WorkflowConnection[]; renamed: Map<string, string> } {
  const renamed = new Map<string, string>();
  if (!hasLegacyOperationNodes(inputNodes)) return { nodes: inputNodes, connections: inputConnections, renamed };
  let nodes = [...inputNodes];
  let connections = [...inputConnections];

  for (const legacy of inputNodes.filter(node => node.type === 'operation')) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const operationNode = byId.get(legacy.id);
    if (!operationNode) continue;
    const record = operationNode.metadata.operation;
    const resultType = resultTypeOf(record);
    const related = connections.filter(connection => connection.fromNodeId === operationNode.id || connection.toNodeId === operationNode.id);
    const incoming = related.filter(connection => connection.toNodeId === operationNode.id);
    const outgoing = related.filter(connection => connection.fromNodeId === operationNode.id);
    const firstInputId = (record?.recipe.inputBindings || [])
      .slice()
      .sort((left, right) => left.order - right.order)
      .map(binding => binding.sourceNodeId)
      .find(id => byId.has(id))
      || incoming[0]?.fromNodeId;
    const isOutputOf = (node: WorkflowNode) => node.metadata.sourceOperationNodeId === operationNode.id
      || outgoing.some(connection => connection.toNodeId === node.id && connection.kind === 'operation-output')
      || Boolean(record?.takes?.some(take => take.outputNodeIds?.includes(node.id)));

    // 主结果：选中 / 最新成功 take 的第一个现存输出（同类型、自己没有生成记录、有媒体）。
    let primary: WorkflowNode | undefined;
    if (record && !operationNode.metadata.storageKey) {
      for (const take of preferredTakeOrder(record)) {
        primary = take.outputNodeIds
          .map(id => byId.get(id))
          .find((node): node is WorkflowNode => Boolean(node && node.id !== operationNode.id && node.type === resultType && !node.metadata.operation && node.metadata.storageKey));
        if (primary) break;
      }
    }
    const resultId = primary?.id || operationNode.id;
    const snapshot: WorkflowLegacyOperationSnapshot = {
      node: operationNode,
      connections: related,
      ...(primary ? { resultNodeBefore: primary } : {}),
      reownedNodeIds: [],
      migratedAt: now,
    };

    // 每个成功 take 的媒体：并入时在 R 上可切换；原位转换时在 O 上可切换。
    const takes = (record?.takes || []).map(take => {
      if (take.status !== 'success') return take;
      if (take.outputMedia?.storageKey) {
        return take.outputNodeIds.includes(resultId) ? take : { ...take, outputNodeIds: [resultId, ...take.outputNodeIds] };
      }
      const outputNode = take.outputNodeIds.map(id => byId.get(id)).find(node => node && node.type === resultType && node.metadata.storageKey);
      const media = mediaOf(outputNode);
      if (!media) return take;
      return { ...take, outputMedia: media, outputNodeIds: [resultId, ...take.outputNodeIds.filter(id => id !== resultId)] };
    });
    const migratedRecord = record ? { ...record, takes } : undefined;

    const resultNode: WorkflowNode = primary
      ? {
        ...primary,
        objectVersion: (primary.objectVersion || 1) + 1,
        metadata: {
          ...primary.metadata,
          prompt: operationNode.metadata.prompt ?? primary.metadata.prompt,
          richTextDocument: operationNode.metadata.richTextDocument ?? primary.metadata.richTextDocument,
          config: { ...(primary.metadata.config || {}), ...(operationNode.metadata.config || {}) } as WorkflowNodeMetadata['config'],
          operation: migratedRecord,
          sourceOperationNodeId: undefined,
          legacyOperationNode: snapshot,
        },
      }
      : (() => {
        // 原位：O 变成结果类型；有选中输出就把它的媒体复制过来显示。
        const selectedTake = record ? preferredTakeOrder(record)[0] : undefined;
        const selectedOutput = selectedTake?.outputNodeIds.map(id => byId.get(id)).find(node => node && node.id !== operationNode.id && node.type === resultType && node.metadata.storageKey);
        return {
          ...operationNode,
          type: resultType,
          objectVersion: (operationNode.objectVersion || 1) + 1,
          ...(selectedOutput ? { width: selectedOutput.width, height: selectedOutput.height } : {}),
          metadata: {
            ...operationNode.metadata,
            ...(selectedOutput && !operationNode.metadata.storageKey ? { ...copyMedia(selectedOutput), href: undefined, operationTakeId: selectedTake?.id } : {}),
            operation: migratedRecord,
            legacyOperationNode: snapshot,
          },
        } as WorkflowNode;
      })();

    // 连线：进 O → 进 R；O → R 删除；O → 其它输出 → 首个输入 → 输出（operation-output）。
    const existingPairs = new Set(connections.filter(connection => !related.includes(connection)).map(connection => connection.fromNodeId + '>' + connection.toNodeId));
    const rewired: WorkflowConnection[] = [];
    const pushUnique = (connection: WorkflowConnection) => {
      if (connection.fromNodeId === connection.toNodeId) return;
      const key = connection.fromNodeId + '>' + connection.toNodeId;
      if (existingPairs.has(key)) return;
      existingPairs.add(key);
      rewired.push(connection);
    };
    for (const connection of incoming) pushUnique({ ...connection, toNodeId: resultId });
    for (const connection of outgoing) {
      if (connection.toNodeId === resultId) continue;
      const target = byId.get(connection.toNodeId);
      if (!target) continue;
      if (isOutputOf(target)) {
        if (firstInputId && firstInputId !== target.id) pushUnique({ ...connection, fromNodeId: firstInputId, kind: 'operation-output' });
      } else {
        pushUnique({ ...connection, fromNodeId: resultId });
      }
    }

    nodes = nodes.flatMap(node => {
      if (node.id === operationNode.id) return primary ? [] : [resultNode];
      if (primary && node.id === primary.id) return [resultNode];
      if (node.metadata.sourceOperationNodeId === operationNode.id && node.id !== resultId) {
        snapshot.reownedNodeIds.push(node.id);
        return [{ ...node, metadata: { ...node.metadata, sourceOperationNodeId: resultId } }];
      }
      return [node];
    });
    connections = [...connections.filter(connection => !related.includes(connection)), ...rewired];
    if (primary) renamed.set(operationNode.id, primary.id);
  }
  return { nodes, connections, renamed };
}

/** 还原 v6 迁移：把带 legacyOperationNode 的结果节点恢复成迁移前的 operation 节点结构。迁移后对这些节点的修改会丢失。 */
export function revertWorkflowDirectOutputMigration<T extends { nodes: WorkflowNode[]; connections: WorkflowConnection[] }>(project: T): T {
  let nodes = [...project.nodes];
  let connections = [...project.connections];
  for (const holder of project.nodes.filter(node => node.metadata.legacyOperationNode)) {
    const legacy = holder.metadata.legacyOperationNode as WorkflowLegacyOperationSnapshot;
    const restoredOperation = legacy.node;
    const merged = holder.id !== restoredOperation.id;
    const legacyIds = new Set(legacy.connections.map(connection => connection.id));
    const reowned = new Set(legacy.reownedNodeIds);
    nodes = nodes.flatMap(node => {
      if (node.id !== holder.id) {
        return reowned.has(node.id) ? [{ ...node, metadata: { ...node.metadata, sourceOperationNodeId: restoredOperation.id } }] : [node];
      }
      if (!merged) return [restoredOperation];
      const restoredResult: WorkflowNode = legacy.resultNodeBefore
        ? { ...legacy.resultNodeBefore, position: node.position }
        : { ...node, metadata: { ...node.metadata, operation: undefined, legacyOperationNode: undefined } };
      return [restoredOperation, restoredResult];
    });
    connections = [...connections.filter(connection => !legacyIds.has(connection.id)), ...legacy.connections];
  }
  return { ...project, nodes, connections };
}
