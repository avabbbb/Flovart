// 制作圣经（P1）：把散落在节点上的 shot / anchor 元数据汇总成一份结构化项目状态，
// 供 workflow.inspect 返回给 Agent：锚点表、按镜号排序的镜头表、总时长与一致性问题。纯函数。
import type { WorkflowConnection, WorkflowNode } from './types';

export interface ProductionBibleAnchor { nodeId: string; title: string; kind: string; approved: boolean }
export interface ProductionBibleShot {
  nodeId: string;
  index: number;
  title: string;
  durationSec?: number;
  scene?: string;
  camera?: string;
  dialogue?: string;
  anchorNodeIds: string[];
  hasMedia: boolean;
}
export interface ProductionBible {
  anchors: ProductionBibleAnchor[];
  shots: ProductionBibleShot[];
  totals: { shotCount: number; durationSec: number; approvedAnchors: number; pendingAnchors: number; shotsWithoutMedia: number };
  issues: string[];
}

const hasMedia = (node: WorkflowNode) => {
  const metadata = (node.metadata || {}) as Record<string, unknown>;
  return Boolean(metadata.href || metadata.storageKey || metadata.artifactRef || metadata.remoteUrl);
};

export function buildProductionBible(project: { nodes?: WorkflowNode[]; connections?: WorkflowConnection[] } | null | undefined): ProductionBible {
  const nodes = Array.isArray(project?.nodes) ? project.nodes : [];
  const connections = Array.isArray(project?.connections) ? project.connections : [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const anchors = nodes
    .filter(node => node.anchor)
    .map(node => ({ nodeId: node.id, title: node.title, kind: node.anchor!.kind, approved: node.anchor!.approved === true }));
  const approved = new Set(anchors.filter(anchor => anchor.approved).map(anchor => anchor.nodeId));
  const issues: string[] = [];

  const shots = nodes
    .filter(node => node.shot && Number.isFinite(node.shot.index))
    .map(node => {
      const shot = node.shot!;
      const explicit = Array.isArray(shot.anchorNodeIds) ? shot.anchorNodeIds : null;
      const upstream = connections.filter(edge => edge.toNodeId === node.id && approved.has(edge.fromNodeId)).map(edge => edge.fromNodeId);
      const anchorNodeIds = explicit ?? [...new Set(upstream)];
      for (const anchorId of explicit ?? []) {
        if (!byId.has(anchorId)) issues.push('镜头 ' + shot.index + ' 引用了不存在的锚点 ' + anchorId);
        else if (!approved.has(anchorId)) issues.push('镜头 ' + shot.index + ' 引用的锚点「' + (byId.get(anchorId)?.title || anchorId) + '」尚未批准');
      }
      return {
        nodeId: node.id,
        index: shot.index,
        title: node.title,
        durationSec: shot.durationSec,
        scene: shot.scene,
        camera: shot.camera,
        dialogue: shot.dialogue,
        anchorNodeIds,
        hasMedia: hasMedia(node),
      };
    })
    .sort((left, right) => left.index - right.index);

  const seen = new Set<number>();
  shots.forEach((shot, position) => {
    if (seen.has(shot.index)) issues.push('镜号 ' + shot.index + ' 重复');
    seen.add(shot.index);
    const previous = shots[position - 1];
    if (previous && shot.index - previous.index > 1) issues.push('镜号在 ' + previous.index + ' 与 ' + shot.index + ' 之间有缺口');
  });

  return {
    anchors,
    shots,
    totals: {
      shotCount: shots.length,
      durationSec: shots.reduce((sum, shot) => sum + (Number(shot.durationSec) || 0), 0),
      approvedAnchors: approved.size,
      pendingAnchors: anchors.length - approved.size,
      shotsWithoutMedia: shots.filter(shot => !shot.hasMedia).length,
    },
    issues,
  };
}
