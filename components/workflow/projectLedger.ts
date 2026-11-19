// 项目账本（P1-3）：锚点速查表 + 镜头表 + 已生成资产索引，全部从同一份 workflow 推导（不建新 store、不建画布文本节点）。
// workflow.inspect ledger=true 返回它，Agent 上下文被压缩后用它回读项目状态；纯函数。
import type { WorkflowAnchorKind, WorkflowConnection, WorkflowNode } from './types';
import { buildProductionBible } from './productionBible';
import { assignAnchorCodes, nodeHasMedia, nodeSearchStatus, type WorkflowNodeSearchStatus } from './nodeSearch';

export interface ProjectLedgerAnchor { code: string; nodeId: string; title: string; kind: WorkflowAnchorKind }
export interface ProjectLedgerPendingAnchor { nodeId: string; title: string; kind: WorkflowAnchorKind }
export interface ProjectLedgerShot {
  index: number;
  nodeId: string;
  title: string;
  durationSec?: number;
  anchorCodes: string[];
  status: WorkflowNodeSearchStatus;
}
export interface ProjectLedgerAsset {
  nodeId: string;
  type: string;
  title: string;
  anchorCode?: string;
  shotIndex?: number;
  promptPreview?: string;
  alternateCount?: number;
  generated: boolean;
}
export interface ProjectLedger {
  anchors: ProjectLedgerAnchor[];
  pendingAnchors: ProjectLedgerPendingAnchor[];
  shots: ProjectLedgerShot[];
  assets: ProjectLedgerAsset[];
  /** 按类型统计的产物数 */
  totals: { anchors: number; pendingAnchors: number; shots: number; durationSec: number; assets: Record<string, number>; failed: number; running: number };
  issues: string[];
}

const MEDIA_TYPES = new Set(['image', 'video', 'audio']);
const PROMPT_PREVIEW = 60;
const KIND_LABEL: Record<WorkflowAnchorKind, string> = { character: '角色', scene: '场景', product: '道具', style: '风格' };

function preview(text: unknown): string | undefined {
  if (typeof text !== 'string') return undefined;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  return clean.length > PROMPT_PREVIEW ? clean.slice(0, PROMPT_PREVIEW - 1) + '…' : clean;
}

export function buildProjectLedger(project: { nodes?: WorkflowNode[]; connections?: WorkflowConnection[] } | null | undefined): ProjectLedger {
  const nodes = Array.isArray(project?.nodes) ? project.nodes : [];
  const codes = assignAnchorCodes(nodes);
  const bible = buildProductionBible(project);
  const byId = new Map(nodes.map(node => [node.id, node]));

  const anchors: ProjectLedgerAnchor[] = [];
  const pendingAnchors: ProjectLedgerPendingAnchor[] = [];
  for (const node of nodes) {
    if (!node.anchor) continue;
    const code = codes.get(node.id);
    if (code) anchors.push({ code, nodeId: node.id, title: node.title, kind: node.anchor.kind });
    else pendingAnchors.push({ nodeId: node.id, title: node.title, kind: node.anchor.kind });
  }
  anchors.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const shots: ProjectLedgerShot[] = bible.shots.map(shot => {
    const node = byId.get(shot.nodeId);
    const entry: ProjectLedgerShot = {
      index: shot.index,
      nodeId: shot.nodeId,
      title: shot.title,
      anchorCodes: shot.anchorNodeIds.map(id => codes.get(id)).filter((code): code is string => Boolean(code)),
      status: node ? nodeSearchStatus(node) : 'empty',
    };
    if (shot.durationSec !== undefined) entry.durationSec = shot.durationSec;
    return entry;
  });

  const assets: ProjectLedgerAsset[] = [];
  const assetTotals: Record<string, number> = {};
  let failed = 0;
  let running = 0;
  for (const node of nodes) {
    const status = nodeSearchStatus(node);
    if (status === 'error') failed += 1;
    if (status === 'running') running += 1;
    if (!MEDIA_TYPES.has(node.type) || !nodeHasMedia(node)) continue;
    const metadata = (node.metadata || {}) as Record<string, unknown>;
    const asset: ProjectLedgerAsset = {
      nodeId: node.id,
      type: node.type,
      title: node.title,
      generated: Boolean(metadata.generationRequestId || metadata.generationHistoryId || metadata.generationProviderTaskId || metadata.config && typeof metadata.prompt === 'string' && metadata.prompt.trim()),
    };
    const code = codes.get(node.id);
    if (code) asset.anchorCode = code;
    if (node.shot && Number.isFinite(node.shot.index)) asset.shotIndex = node.shot.index;
    const prompt = preview(metadata.prompt);
    if (prompt) asset.promptPreview = prompt;
    const alternates = Array.isArray(metadata.alternates) ? metadata.alternates.length : 0;
    if (alternates) asset.alternateCount = alternates;
    assets.push(asset);
    assetTotals[node.type] = (assetTotals[node.type] || 0) + 1;
  }

  return {
    anchors,
    pendingAnchors,
    shots,
    assets,
    totals: {
      anchors: anchors.length,
      pendingAnchors: pendingAnchors.length,
      shots: shots.length,
      durationSec: bible.totals.durationSec,
      assets: assetTotals,
      failed,
      running,
    },
    issues: bible.issues,
  };
}

/** 账本的紧凑文字版：给模型回读用（上下文压缩后、长任务中途），控制在几百字内。 */
export function renderProjectLedger(ledger: ProjectLedger, options: { maxAssets?: number } = {}): string {
  const maxAssets = options.maxAssets ?? 30;
  const lines: string[] = [];
  lines.push('## 锚点速查');
  if (ledger.anchors.length) {
    for (const anchor of ledger.anchors) lines.push('- ' + anchor.code + ' ' + KIND_LABEL[anchor.kind] + '「' + anchor.title + '」→ ' + anchor.nodeId);
  } else {
    lines.push('- （没有已批准的锚点）');
  }
  if (ledger.pendingAnchors.length) {
    lines.push('- 待批准：' + ledger.pendingAnchors.map(anchor => KIND_LABEL[anchor.kind] + '「' + anchor.title + '」(' + anchor.nodeId + ')').join('、'));
  }
  if (ledger.shots.length) {
    lines.push('', '## 镜头表（共 ' + ledger.totals.shots + ' 镜' + (ledger.totals.durationSec ? '，' + ledger.totals.durationSec + 's' : '') + '）');
    for (const shot of ledger.shots) {
      lines.push('- 第 ' + shot.index + ' 镜「' + shot.title + '」' + (shot.durationSec ? shot.durationSec + 's ' : '')
        + (shot.anchorCodes.length ? '[' + shot.anchorCodes.join('+') + '] ' : '') + shot.status + ' → ' + shot.nodeId);
    }
  }
  lines.push('', '## 已有资产（' + (Object.entries(ledger.totals.assets).map(([type, count]) => type + ' ' + count).join('，') || '无') + '）');
  for (const asset of ledger.assets.slice(0, maxAssets)) {
    const tags = [asset.anchorCode, asset.shotIndex !== undefined ? '第' + asset.shotIndex + '镜' : '', asset.generated ? '生成' : '导入', asset.alternateCount ? '备选' + asset.alternateCount : '']
      .filter(Boolean)
      .join(' ');
    lines.push('- ' + asset.type + '「' + asset.title + '」' + (tags ? '（' + tags + '）' : '') + ' → ' + asset.nodeId + (asset.promptPreview ? '：' + asset.promptPreview : ''));
  }
  if (ledger.assets.length > maxAssets) lines.push('- …还有 ' + (ledger.assets.length - maxAssets) + ' 个，用 iris_workflow_search_nodes 查');
  if (ledger.totals.failed || ledger.totals.running) lines.push('', '状态：失败 ' + ledger.totals.failed + '，生成中 ' + ledger.totals.running);
  if (ledger.issues.length) lines.push('', '## 一致性问题', ...ledger.issues.map(issue => '- ' + issue));
  return lines.join('\n');
}
