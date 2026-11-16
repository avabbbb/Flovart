import { createWorkflowNode } from './constants';
import { buildWorkflowPromptDocument } from './promptDocument';
import { inheritGenerationConfig } from '../../services/generationInheritance';
import type {
  ScriptBreakdown,
  ScriptShot,
  WorkflowConnection,
  WorkflowDocumentOperation,
  WorkflowNode,
  WorkflowShotMeta,
} from './types';

/**
 * 分镜行 → 每行一个生成节点（LibTV `script storyboard` 的 Flovart 版，libtv-docs-study P0-4）。
 *
 * 脚本节点是结构化规划节点，它的行不会以“隐藏 prompt”的形式进入生成链：
 * - 每行建一个 image / video 生成节点，提示词写进该节点 Prompt Bar（富文本文档，用户看得见、改得了）；
 * - 行里的锚点（characterRefs 与 prompt 里的 @ref:<id>）以 @chip + 连线接到生成节点；
 * - 节点挂 `shot` 元数据（镜号、景别、运镜、光影……以及来源脚本行）；
 * - 脚本行只回存 imageNodeId / videoNodeId。
 * 纯函数：只产出 WorkflowDocumentOperation，不运行。UI 批量生成与 Agent 命令共用这一份。
 */

export type ScriptMaterializeKind = 'image' | 'video';

export interface ScriptMaterializeDiagnostic {
  code: 'ANCHOR_NOT_FOUND' | 'ANCHOR_IS_NOTE' | 'ANCHOR_NOT_MEDIA' | 'ANCHOR_KIND_UNSUPPORTED' | 'UNRESOLVED_MENTION';
  row: number;
  message: string;
}

export interface ScriptMaterializeCreated {
  /** 1 起的分镜行号（= shot.index + 1） */
  row: number;
  shotId: string;
  nodeId: string;
  prompt: string;
  /** 连到生成节点的锚点（顺序 = chip 顺序） */
  references: string[];
  /** prompt 里写了 @ref:<id>、但没在 characterRefs 里，已自动连线的锚点 */
  autoLinked: string[];
}

export interface ScriptMaterializeSkipped {
  row: number;
  shotId: string;
  reason: 'ALREADY_MATERIALIZED' | 'EMPTY_PROMPT';
  nodeId?: string;
}

export interface ScriptMaterializeResult {
  operations: WorkflowDocumentOperation[];
  created: ScriptMaterializeCreated[];
  skipped: ScriptMaterializeSkipped[];
  diagnostics: ScriptMaterializeDiagnostic[];
  batchId?: string;
}

export interface ScriptMaterializeOptions {
  kind: ScriptMaterializeKind;
  /** 1 起的行号：'1-5' / '1,3,6-9' / [1,2,3]；缺省 = 全部行 */
  rows?: string | readonly number[];
  nodes: readonly WorkflowNode[];
  connections: readonly WorkflowConnection[];
  createId: () => string;
}

export class ScriptMaterializeError extends Error {
  constructor(public code: 'BAD_REQUEST' | 'NOT_FOUND' | 'NOT_SCRIPT' | 'EMPTY_SCRIPT', message: string) {
    super(message);
    this.name = 'ScriptMaterializeError';
  }
}

const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/** 旧 *PromptOverride → imagePrompt / videoPrompt（新字段优先；读写都走这里，旧数据不丢）。 */
export function migrateScriptShot(shot: ScriptShot): ScriptShot {
  const { imagePromptOverride, videoPromptOverride, ...rest } = shot;
  const next: ScriptShot = { ...rest };
  const image = clean(shot.imagePrompt) || clean(imagePromptOverride);
  const video = clean(shot.videoPrompt) || clean(videoPromptOverride);
  if (image) next.imagePrompt = shot.imagePrompt?.trim() ? shot.imagePrompt : imagePromptOverride;
  else delete next.imagePrompt;
  if (video) next.videoPrompt = shot.videoPrompt?.trim() ? shot.videoPrompt : videoPromptOverride;
  else delete next.videoPrompt;
  return next;
}

/** 本行显式写好的提示词（新字段优先，回退旧 Override）。 */
export function scriptShotExplicitPrompt(shot: ScriptShot, kind: ScriptMaterializeKind): string {
  return kind === 'image'
    ? clean(shot.imagePrompt) || clean(shot.imagePromptOverride)
    : clean(shot.videoPrompt) || clean(shot.videoPromptOverride);
}

/** 写进生成节点 Prompt Bar 的提示词：显式字段优先，否则用分镜字段拼一条可编辑的草稿。 */
export function scriptShotPrompt(shot: ScriptShot, kind: ScriptMaterializeKind): string {
  const explicit = scriptShotExplicitPrompt(shot, kind);
  if (explicit) return explicit;
  const parts = kind === 'image'
    ? [shot.shotSize, shot.scene, shot.action, shot.emotion, shot.lighting]
    : [shot.shotSize, shot.camera, shot.scene, shot.action, shot.emotion, shot.lighting];
  return parts.map(clean).filter(Boolean).join(', ');
}

/** '1-5' / '1,3,6-9' / [1,2] → 去重升序的 1 起行号；越界或格式错抛 BAD_REQUEST。 */
export function parseScriptRows(spec: string | readonly number[] | undefined, total: number): number[] {
  if (spec === undefined || spec === null || (typeof spec === 'string' && !spec.trim()) || (typeof spec === 'string' && spec.trim() === 'all')) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const rows = new Set<number>();
  const add = (row: number) => {
    if (!Number.isInteger(row) || row < 1 || row > total) throw new ScriptMaterializeError('BAD_REQUEST', `行号 ${row} 超出范围（1-${total}）`);
    rows.add(row);
  };
  if (Array.isArray(spec)) {
    spec.forEach(value => add(Number(value)));
  } else {
    for (const part of String(spec).split(/[,，\s]+/).filter(Boolean)) {
      const range = /^(\d+)\s*[-~–]\s*(\d+)$/.exec(part);
      if (range) {
        const from = Number(range[1]);
        const to = Number(range[2]);
        if (from > to) throw new ScriptMaterializeError('BAD_REQUEST', `行号范围 ${part} 起点大于终点`);
        for (let row = from; row <= to; row += 1) add(row);
      } else if (/^\d+$/.test(part)) {
        add(Number(part));
      } else {
        throw new ScriptMaterializeError('BAD_REQUEST', `看不懂的行号：${part}（用 1-5 或 1,3,6-9）`);
      }
    }
  }
  return [...rows].sort((a, b) => a - b);
}

const MEDIA = new Set(['image', 'video', 'audio']);
const REF_PATTERN = /@ref:([A-Za-z0-9_.:-]+)/g;

/** 按镜号（shot.index）排行；index 重复或缺失时保持原顺序。行号 = 排序后的位置 + 1。 */
function orderedShots(breakdown: ScriptBreakdown) {
  return breakdown.shots
    .map((shot, position) => ({ shot, position }))
    .sort((a, b) => (a.shot.index ?? a.position) - (b.shot.index ?? b.position) || a.position - b.position)
    .map(entry => entry.shot);
}

export function buildScriptMaterializeOps(script: WorkflowNode, options: ScriptMaterializeOptions): ScriptMaterializeResult {
  if (!script || script.type !== 'script') throw new ScriptMaterializeError('NOT_SCRIPT', `节点 ${script?.id || ''} 不是脚本节点`);
  const breakdown = script.metadata.scriptBreakdown;
  if (!breakdown || !breakdown.shots.length) throw new ScriptMaterializeError('EMPTY_SCRIPT', '脚本还没有分镜行，先拆解剧本');
  const { kind } = options;
  const shots = orderedShots(breakdown);
  const rows = parseScriptRows(options.rows, shots.length);
  const byId = new Map(options.nodes.map(node => [node.id, node]));

  const created: ScriptMaterializeCreated[] = [];
  const skipped: ScriptMaterializeSkipped[] = [];
  const diagnostics: ScriptMaterializeDiagnostic[] = [];
  const pending: Array<{ row: number; shot: ScriptShot; prompt: string }> = [];
  for (const row of rows) {
    const shot = shots[row - 1];
    const existing = kind === 'image' ? shot.imageNodeId : shot.videoNodeId;
    if (existing && byId.has(existing)) {
      skipped.push({ row, shotId: shot.id, reason: 'ALREADY_MATERIALIZED', nodeId: existing });
      continue;
    }
    const prompt = scriptShotPrompt(shot, kind);
    if (!prompt) {
      skipped.push({ row, shotId: shot.id, reason: 'EMPTY_PROMPT' });
      continue;
    }
    pending.push({ row, shot, prompt });
  }

  // 已经物化过的同模式节点给新节点继承模型 / 比例 / 风格，避免回退默认模型。
  const inheritedConfig = inheritGenerationConfig(kind, breakdown.shots.map(shot => {
    const id = kind === 'image' ? shot.imageNodeId : shot.videoNodeId;
    return id ? byId.get(id) : undefined;
  }));

  // 落位：脚本右侧网格，每排 5 个；网格区域内已有节点时整体右移避让。
  const sample = createWorkflowNode('__probe__', kind, { x: 0, y: 0 });
  const nodeWidth = sample.width;
  const nodeHeight = sample.height;
  const gap = 20;
  const perRow = 5;
  const startX = script.position.x + script.width + 80;
  const startY = script.position.y;
  const gridRows = Math.max(1, Math.ceil(pending.length / perRow));
  const rightEdge = Math.max(startX, ...options.nodes
    .filter(node => node.position.x < startX + perRow * (nodeWidth + gap) && node.position.x + node.width > startX
      && node.position.y < startY + gridRows * (nodeHeight + gap) && node.position.y + node.height > startY)
    .map(node => node.position.x + node.width + gap));
  const originX = rightEdge;

  const operations: WorkflowDocumentOperation[] = [];
  let nodes = [...options.nodes];
  let connections = [...options.connections];
  const links = new Map<string, string>();

  pending.forEach(({ row, shot, prompt }, order) => {
    const nodeId = options.createId();
    // 锚点：characterRefs 在前（顺序 = 参考槽位），prompt 里的 @ref:<id> 追加并记为 autoLinked。
    const declared = (shot.characterRefs || []).filter(Boolean);
    const mentioned = [...prompt.matchAll(REF_PATTERN)].map(match => match[1]).filter(id => !declared.includes(id));
    const references: string[] = [];
    const autoLinked: string[] = [];
    for (const id of [...declared, ...mentioned]) {
      if (references.includes(id)) continue;
      const anchor = byId.get(id);
      const fromPrompt = !declared.includes(id);
      if (!anchor) {
        // prompt 里引用了不存在的节点：交给 buildWorkflowPromptDocument 记 UNRESOLVED_MENTION
        if (!fromPrompt) diagnostics.push({ code: 'ANCHOR_NOT_FOUND', row, message: `第 ${row} 行的锚点 ${id} 不存在，已跳过` });
        continue;
      }
      if (anchor.type === 'text') {
        diagnostics.push({ code: 'ANCHOR_IS_NOTE', row, message: `第 ${row} 行引用的 ${id} 是备注（文本节点），不能当参考，已跳过` });
        continue;
      }
      if (!MEDIA.has(anchor.type)) {
        diagnostics.push({ code: 'ANCHOR_NOT_MEDIA', row, message: `第 ${row} 行的锚点 ${id}（${anchor.type}）不是图片/视频/音频，已跳过` });
        continue;
      }
      if (kind === 'image' && anchor.type !== 'image') {
        diagnostics.push({ code: 'ANCHOR_KIND_UNSUPPORTED', row, message: `第 ${row} 行：图片生成只接收图片参考，${id}（${anchor.type}）已跳过` });
        continue;
      }
      references.push(id);
      if (fromPrompt) autoLinked.push(id);
    }

    const node = createWorkflowNode(nodeId, kind, {
      x: originX + (order % perRow) * (nodeWidth + gap),
      y: startY + Math.floor(order / perRow) * (nodeHeight + gap),
    }, { status: 'idle', ...(inheritedConfig ? { config: inheritedConfig } : {}) });
    node.title = `分镜 ${row}`;
    const shotMeta: WorkflowShotMeta = {
      index: row,
      ...(shot.durationSec !== undefined ? { durationSec: shot.durationSec } : {}),
      ...(clean(shot.scene) ? { scene: shot.scene } : {}),
      ...(clean(shot.camera) ? { camera: shot.camera } : {}),
      ...(clean(shot.dialogue) ? { dialogue: shot.dialogue } : {}),
      ...(clean(shot.shotSize) ? { shotSize: shot.shotSize } : {}),
      ...(clean(shot.lighting) ? { lighting: shot.lighting } : {}),
      ...(clean(shot.audio) ? { audio: shot.audio } : {}),
      ...(references.length ? { anchorNodeIds: references } : {}),
      scriptNodeId: script.id,
      scriptShotId: shot.id,
    };
    node.shot = shotMeta;
    operations.push({ type: 'add_node', node });
    nodes = [...nodes, node];

    for (const id of references) {
      const connection: WorkflowConnection = { id: 'conn-' + options.createId(), fromNodeId: id, toNodeId: nodeId };
      operations.push({ type: 'connect_nodes', id: connection.id, fromNodeId: id, toNodeId: nodeId });
      connections = [...connections, connection];
    }
    // 脚本 → 分镜的结构连线（脚本不是媒体，不进入参考 / prompt）
    const scriptLink: WorkflowConnection = { id: 'conn-' + options.createId(), fromNodeId: script.id, toNodeId: nodeId };
    operations.push({ type: 'connect_nodes', id: scriptLink.id, fromNodeId: script.id, toNodeId: nodeId });
    connections = [...connections, scriptLink];

    const document = buildWorkflowPromptDocument({ text: prompt, targetNodeId: nodeId, nodes, connections, ensureMentionIds: references });
    if (document.unresolved.length) {
      diagnostics.push({ code: 'UNRESOLVED_MENTION', row, message: `第 ${row} 行 prompt 里的 @ref:${document.unresolved.join('、@ref:')} 不是可用的媒体节点，已保留为文字` });
    }
    operations.push({ type: 'update_node', id: nodeId, metadata: { prompt: document.prompt, richTextDocument: document.richTextDocument } });
    links.set(shot.id, nodeId);
    created.push({ row, shotId: shot.id, nodeId, prompt: document.prompt, references, autoLinked });
  });

  if (!created.length) return { operations: [], created, skipped, diagnostics };

  // 脚本行只回存节点 id；同时把旧 *Override 迁移为 imagePrompt / videoPrompt。
  const updatedShots = breakdown.shots.map(shot => {
    const migrated = migrateScriptShot(shot);
    const nodeId = links.get(shot.id);
    if (!nodeId) return migrated;
    return kind === 'image' ? { ...migrated, imageNodeId: nodeId } : { ...migrated, videoNodeId: nodeId };
  });
  operations.push({ type: 'update_node', id: script.id, metadata: { scriptBreakdown: { ...breakdown, shots: updatedShots } } });
  const batchId = created.length > 1 ? 'shots-' + options.createId() : undefined;
  if (batchId) operations.push({ type: 'group_nodes', ids: created.map(item => item.nodeId), batchId, source: 'auto' });
  return { operations, created, skipped, diagnostics, ...(batchId ? { batchId } : {}) };
}
