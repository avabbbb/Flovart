import type { AssetItem } from '../../types';
import type { PromptReferenceMention } from '../../utils/promptReferenceClipboard';
import { createWorkflowNode } from './constants';
import { validateWorkflowConnection } from './ops';
import type { WorkflowNode, WorkflowOp, WorkflowSnapshot } from './types';

interface BuildWorkflowPromptPasteOpsInput {
  targetNodeId: string;
  snapshot: WorkflowSnapshot;
  assets: AssetItem[];
  mentions: PromptReferenceMention[];
  createId: () => string;
}

export interface WorkflowPromptPasteOps {
  ops: WorkflowOp[];
  resolvedMentions: Array<PromptReferenceMention | null>;
}

const INPUT_TYPES = new Set(['image', 'video', 'audio', 'text']);

export function buildWorkflowPromptPasteOps({
  targetNodeId,
  snapshot,
  assets,
  mentions,
  createId,
}: BuildWorkflowPromptPasteOpsInput): WorkflowPromptPasteOps {
  const { nodes, connections } = snapshot;
  const target = nodes.find(node => node.id === targetNodeId);
  if (!target) return { ops: [], resolvedMentions: mentions.map(() => null) };
  const ops: WorkflowOp[] = [];
  const virtualNodes = [...nodes];
  const virtualConnections = [...connections];
  const referenceOrder = [...(target.metadata.imageReferenceOrder || [])];
  const mentionedNodeIds = [...(target.metadata.mentionedNodeIds || [])];
  let createdAssetCount = 0;
  const resolvedMentions = mentions.map(mention => {
    let source = virtualNodes.find(node => node.id === mention.id);
    if (!source && mention.assetId) source = virtualNodes.find(node => node.metadata.assetId === mention.assetId);
    if (!source && mention.assetId) {
      const asset = assets.find(item => item.id === mention.assetId);
      if (asset) {
        const id = createId();
        const type = asset.mimeType.startsWith('video/') ? 'video' : asset.mimeType.startsWith('audio/') ? 'audio' : 'image';
        const created = createWorkflowNode(id, type, {
          x: target.position.x + (target.width - 340) / 2 + createdAssetCount * 28,
          y: target.position.y - 360 - createdAssetCount * 28,
        }, {
          sourceType: 'assetLibrary',
          assetId: asset.id,
          href: `asset-library:${asset.id}`,
          name: asset.name || mention.label || '素材引用',
          mimeType: asset.mimeType,
          naturalWidth: asset.width,
          naturalHeight: asset.height,
          status: 'success',
        });
        created.title = asset.name || mention.label || created.title;
        createdAssetCount += 1;
        source = created;
        virtualNodes.push(created);
        ops.push({ type: 'add_node', node: created });
      }
    }
    if (!source || source.id === targetNodeId || !INPUT_TYPES.has(source.type)) return null;
    const connected = virtualConnections.some(connection => connection.fromNodeId === source.id && connection.toNodeId === targetNodeId);
    if (!connected) {
      const validationSnapshot: WorkflowSnapshot = {
        ...snapshot,
        nodes: virtualNodes,
        connections: virtualConnections,
        selectedNodeIds: [targetNodeId],
      };
      if (!validateWorkflowConnection(validationSnapshot, source.id, targetNodeId).ok) return null;
      ops.push({ type: 'connect_nodes', fromNodeId: source.id, toNodeId: targetNodeId });
      virtualConnections.push({ id: `prompt-paste:${source.id}:${targetNodeId}`, fromNodeId: source.id, toNodeId: targetNodeId });
    }
    if (source.type !== 'text' && !referenceOrder.includes(source.id)) referenceOrder.push(source.id);
    if (!mentionedNodeIds.includes(source.id)) mentionedNodeIds.push(source.id);
    return {
      ...mention,
      id: source.id,
      thumbnail: source.metadata.href || mention.thumbnail,
      elementType: source.type,
      sourceType: source.metadata.assetId ? 'assetLibrary' as const : 'connected' as const,
      assetId: source.metadata.assetId || mention.assetId,
    };
  });
  if (resolvedMentions.some(Boolean)) {
    ops.push({
      type: 'update_node',
      id: targetNodeId,
      metadata: { imageReferenceOrder: referenceOrder, mentionedNodeIds },
    });
  }
  return { ops, resolvedMentions };
}
