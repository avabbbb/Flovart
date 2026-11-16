// 制作圣经（P1）：把散落在节点上的 shot / anchor 元数据汇总成一份结构化项目状态，
// 供 workflow.inspect 返回给 Agent：锚点表、按镜号排序的镜头表、总时长与一致性问题。纯函数。
import { deriveAnchorCodes } from '../../services/anchorApproval';
import { planAssembly } from './shotAssembly';
import type { WorkflowConnection, WorkflowNode } from './types';

export interface ProductionBibleAnchor { nodeId: string; title: string; kind: string; approved: boolean; code?: string }
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
  const codes = deriveAnchorCodes(nodes);
  const anchors: ProductionBibleAnchor[] = nodes
    .filter(node => node.anchor)
    .map(node => ({ nodeId: node.id, title: node.title, kind: node.anchor!.kind, approved: node.anchor!.approved === true, ...(codes.get(node.id) ? { code: codes.get(node.id) } : {}) }));
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

// ---- 故事板第二视图（P1-4）：同一份 workflow 推导，不建独立 store ----

export interface StoryboardMedia { href?: string; storageKey?: string; poster?: string; posterStorageKey?: string }
export interface StoryboardAnchorCard extends ProductionBibleAnchor { media?: StoryboardMedia }
export interface StoryboardShotRow extends ProductionBibleShot {
  type: string;
  prompt: string;
  anchorCodes: string[];
  media?: StoryboardMedia;
  /** 上游连进来的非锚点图片（参考图/首帧等），便于在行内看到这一镜用到的图。 */
  referenceImageIds: string[];
}
export interface StoryboardTimelineClip { nodeId: string; index: number; title: string; startSec: number; durationSec: number; hasMedia: boolean; media?: StoryboardMedia }
export interface StoryboardFinalCut {
  /** 视频镜头的拼接计划（video.merge@1 的 sourceNodeIds 即 plan.sourceNodeIds）。 */
  plan: ReturnType<typeof planAssembly>;
  /** 画布上已有的成片（video.merge@1 Operation 节点），新的在前。 */
  mergedNodeIds: string[];
}
export interface StoryboardView {
  anchors: StoryboardAnchorCard[];
  rows: StoryboardShotRow[];
  images: StoryboardShotRow[];
  timeline: StoryboardTimelineClip[];
  final: StoryboardFinalCut;
  totals: ProductionBible['totals'];
  issues: string[];
}

const mediaOf = (node: WorkflowNode | undefined): StoryboardMedia | undefined => {
  if (!node) return undefined;
  const metadata = node.metadata || ({} as WorkflowNode['metadata']);
  const media: StoryboardMedia = {
    ...(metadata.href ? { href: metadata.href } : {}),
    ...(metadata.storageKey ? { storageKey: metadata.storageKey } : {}),
    ...(metadata.poster ? { poster: metadata.poster } : {}),
    ...(metadata.posterStorageKey ? { posterStorageKey: metadata.posterStorageKey } : {}),
  };
  return Object.keys(media).length ? media : undefined;
};

const codeOrder = (code?: string) => (code ? 'APST'.indexOf(code[0]) * 1000 + Number(code.slice(1)) : Number.MAX_SAFE_INTEGER);

export function buildStoryboardView(project: { nodes?: WorkflowNode[]; connections?: WorkflowConnection[] } | null | undefined): StoryboardView {
  const nodes = Array.isArray(project?.nodes) ? project.nodes : [];
  const connections = Array.isArray(project?.connections) ? project.connections : [];
  const bible = buildProductionBible({ nodes, connections });
  const byId = new Map(nodes.map(node => [node.id, node]));
  const codeById = new Map(bible.anchors.filter(anchor => anchor.code).map(anchor => [anchor.nodeId, anchor.code!]));

  const anchors = bible.anchors
    .map(anchor => ({ ...anchor, ...(mediaOf(byId.get(anchor.nodeId)) ? { media: mediaOf(byId.get(anchor.nodeId)) } : {}) }))
    .sort((left, right) => codeOrder(left.code) - codeOrder(right.code));

  const rows: StoryboardShotRow[] = bible.shots.map(shot => {
    const node = byId.get(shot.nodeId)!;
    const referenceImageIds = connections
      .filter(edge => edge.toNodeId === shot.nodeId)
      .map(edge => byId.get(edge.fromNodeId))
      .filter((source): source is WorkflowNode => Boolean(source && source.type === 'image' && !source.anchor))
      .map(source => source.id);
    const media = mediaOf(node);
    return {
      ...shot,
      type: node.type,
      prompt: node.metadata?.prompt || '',
      anchorCodes: shot.anchorNodeIds.map(id => codeById.get(id)).filter((code): code is string => Boolean(code)),
      ...(media ? { media } : {}),
      referenceImageIds: [...new Set(referenceImageIds)],
    };
  });

  const videoRows = rows.filter(row => row.type === 'video');
  let cursor = 0;
  const timeline = videoRows.map(row => {
    const node = byId.get(row.nodeId)!;
    const measured = node.metadata?.durationMs ? node.metadata.durationMs / 1000 : 0;
    const durationSec = Math.round((measured || Number(row.durationSec) || 0) * 100) / 100;
    const clip = { nodeId: row.nodeId, index: row.index, title: row.title, startSec: Math.round(cursor * 100) / 100, durationSec, hasMedia: row.hasMedia, ...(row.media ? { media: row.media } : {}) };
    cursor += durationSec;
    return clip;
  });

  const mergedNodeIds = nodes
    .filter(node => node.metadata?.operation?.capabilityId === 'video.merge@1')
    .map(node => node.id)
    .reverse();

  return {
    anchors,
    rows,
    images: rows.filter(row => row.type === 'image'),
    timeline,
    final: { plan: planAssembly({ shots: videoRows }), mergedNodeIds },
    totals: bible.totals,
    issues: bible.issues,
  };
}
