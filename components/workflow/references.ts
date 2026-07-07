import type { MentionItem } from '../MentionList';
import type { SeedanceReferences, WorkflowConnection, WorkflowNode } from './types';

export const EMPTY_SEEDANCE_REFERENCES: SeedanceReferences = {
  imageRefs: [],
  videoRefs: [],
  audioRefs: [],
};

export function getWorkflowInputNodeIds(targetNodeId: string, connections: WorkflowConnection[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const connection of connections) {
    if (connection.toNodeId !== targetNodeId || seen.has(connection.fromNodeId)) continue;
    seen.add(connection.fromNodeId);
    ids.push(connection.fromNodeId);
  }
  return ids;
}

export function getWorkflowInputNodes(
  targetNode: WorkflowNode,
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
): WorkflowNode[] {
  const allowedIds = new Set(getWorkflowInputNodeIds(targetNode.id, connections));
  return nodes.filter(node => allowedIds.has(node.id) && node.id !== targetNode.id && node.isVisible !== false);
}

export function filterWorkflowInputIds(ids: string[], targetNodeId: string, connections: WorkflowConnection[]): string[] {
  const allowedIds = new Set(getWorkflowInputNodeIds(targetNodeId, connections));
  const seen = new Set<string>();
  return ids.filter(id => {
    if (!allowedIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function toWorkflowMentionItems(nodes: WorkflowNode[]): MentionItem[] {
  return nodes.map(item => ({
    id: item.id,
    label: item.title,
    thumbnail: item.metadata.href || '',
    elementType: item.type,
    description: item.metadata.content?.trim().slice(0, 36) || item.type,
  }));
}

export function filterSeedanceReferences(
  refs: SeedanceReferences | undefined,
  targetNodeId: string,
  connections: WorkflowConnection[],
): SeedanceReferences {
  const value = refs || EMPTY_SEEDANCE_REFERENCES;
  return {
    imageRefs: filterWorkflowInputIds(value.imageRefs, targetNodeId, connections),
    videoRefs: filterWorkflowInputIds(value.videoRefs, targetNodeId, connections),
    audioRefs: filterWorkflowInputIds(value.audioRefs, targetNodeId, connections),
  };
}
