import { createWorkflowNode } from '../../components/workflow/constants';
import { buildWorkflowPromptDocument } from '../../components/workflow/promptDocument';
import type { ScriptBreakdown, ScriptShot, WorkflowConnection, WorkflowNode, WorkflowPoint, WorkflowShotMeta } from '../../components/workflow/types';
import { toScriptBreakdown } from './video';
import type { ReverseVideoProject } from './types';

// 二开（Hypit 无节点图）：逆向工程 ↔ Workflow 子画布的纯映射。
// 文档仍是扁平 nodes + connections：子节点以 parentId 指向 subgraph 框，以 metadata.reverseKey 对应逆向对象。
// 本模块只产出节点/连线数据；写入由 workflowBridge 经 workflow.apply 完成。

export const REVERSE_SUBGRAPH_TYPE = 'subgraph' as const;
export const REVERSE_SCRIPT_KEY = 'script';
export const REVERSE_SHOT_KEY_PREFIX = 'shot:';

export type ReverseIdFactory = () => string;

export interface ReverseSubgraphPlan {
  frame: WorkflowNode;
  children: WorkflowNode[];
  connections: WorkflowConnection[];
}

export interface ReverseSubgraphState {
  frame: WorkflowNode;
  children: readonly WorkflowNode[];
}

export interface ReverseSubgraphSync {
  add: WorkflowNode[];
  // 完整节点：布局（position/width/height）与已选生成版本取自画布现状，只替换内容字段。
  update: WorkflowNode[];
  remove: string[];
  // 期望存在的全部连线（含已有的）；调用方按端点去重后只补缺。
  connections: WorkflowConnection[];
}

const PAD = 40;
// 子画布框头部高度（SubgraphFrameSurface 的 .workflow-subgraph-header 固定为此高度）。
export const SUBGRAPH_HEADER_HEIGHT = 32;
// 子节点标题条悬于节点上方（.workflow-node__title top:-28px），子节点起始 y 还要让出这段。
export const SUBGRAPH_CHILD_TITLE_CLEARANCE = 28;
const HEADER = SUBGRAPH_HEADER_HEIGHT + SUBGRAPH_CHILD_TITLE_CLEARANCE + 12;
const COLUMN_GAP = 80;
const ROW_GAP = 40;
const SCRIPT_WIDTH = 720;
const SCRIPT_MIN_HEIGHT = 560;
const SHOT_WIDTH = 340;
const SHOT_HEIGHT = 220;

export const shotKey = (shotId: string): string => REVERSE_SHOT_KEY_PREFIX + shotId;

function isManagedKey(key: string | undefined): key is string {
  return key === REVERSE_SCRIPT_KEY || (key !== undefined && key.startsWith(REVERSE_SHOT_KEY_PREFIX));
}

function scriptHeight(shotCount: number): number {
  return Math.max(SCRIPT_MIN_HEIGHT, 160 + shotCount * 72);
}

// 按 key 派生的确定性 id；workflowBridge 传入 nanoid 工厂以避免跨项目冲突。
function keyedIds(prefix: string): (key: string) => string {
  return (key) => prefix + ':' + key;
}

// 写入/清除一组字段：值为 undefined 的键被删除，其余字段保持原样。
function assignOwned<T extends object>(base: T, owned: Partial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(owned)) {
    if (value === undefined) delete out[key];
    else out[key] = value;
  }
  return out as T;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',') + '}';
  }
  return JSON.stringify(value);
}

// ── 镜头内容：每个镜头是一个 image 生成节点，画面提示词写进它的 Prompt Bar；台词等放在 shot 元数据。
// 文本节点只是备注（硬规则），不再承载镜头；旧版逆向留下的 text 镜头节点在同步时替换为生成节点。
interface ShotContent {
  title: string;
  prompt: string;
  shot: WorkflowShotMeta;
}

function shotContent(shot: ScriptShot): ShotContent {
  const prompt = [shot.action, shot.camera ? '运镜：' + shot.camera : undefined].filter(Boolean).join('\n');
  return {
    title: '镜头 ' + shot.index,
    prompt,
    shot: { index: shot.index, durationSec: shot.durationSec, camera: shot.camera, dialogue: shot.dialogue },
  };
}

function applyShotContent(node: WorkflowNode, desired: ShotContent, key: string): WorkflowNode {
  // 提示词没变时保留用户在 Prompt Bar 里插的 @chip；变了才按新文本重写文档。
  const samePrompt = node.metadata.prompt === desired.prompt && node.metadata.richTextDocument;
  const document = samePrompt ? null : buildWorkflowPromptDocument({ text: desired.prompt, targetNodeId: node.id, nodes: [], connections: [] });
  const { content: _legacyContent, ...metadata } = node.metadata;
  return {
    ...node,
    title: desired.title,
    shot: assignOwned(node.shot ?? { index: desired.shot.index }, desired.shot),
    metadata: {
      ...metadata,
      ...(document ? { prompt: document.prompt, richTextDocument: document.richTextDocument } : {}),
      reverseKey: key,
    },
  };
}

// 脚本行回链：新建的镜头生成节点写回 imageNodeId（已有回链保持不动）。
function linkShotNodes(breakdown: ScriptBreakdown, nodeIds: ReadonlyMap<string, string>, stale: ReadonlySet<string> = new Set()): ScriptBreakdown {
  return {
    ...breakdown,
    shots: breakdown.shots.map((shot) => (nodeIds.has(shot.id) && (!shot.imageNodeId || stale.has(shot.imageNodeId)) ? { ...shot, imageNodeId: nodeIds.get(shot.id) } : shot)),
  };
}

// 脚本：逆向拥有 id/index/durationSec/camera/action/dialogue 与 sourceText；
// 画布侧字段（imageNodeId/videoNodeId/status/override/assets…）按镜头 id 保留。
const OWNED_SHOT_FIELDS = ['index', 'durationSec', 'camera', 'action', 'dialogue'] as const;

function mergeBreakdown(previous: ScriptBreakdown | undefined, desired: ScriptBreakdown): ScriptBreakdown {
  if (!previous) return desired;
  const prevShots = new Map(previous.shots.map((s) => [s.id, s] as const));
  const shots = desired.shots.map((shot) => {
    const prev = prevShots.get(shot.id);
    if (!prev) return shot;
    const owned: Partial<ScriptShot> = {};
    for (const field of OWNED_SHOT_FIELDS) (owned as Record<string, unknown>)[field] = shot[field];
    return assignOwned(prev, owned);
  });
  return assignOwned(previous, { shots, sourceText: desired.sourceText });
}

function applyScriptContent(node: WorkflowNode, title: string, breakdown: ScriptBreakdown): WorkflowNode {
  return {
    ...node,
    title,
    metadata: { ...node.metadata, scriptBreakdown: mergeBreakdown(node.metadata.scriptBreakdown, breakdown), reverseKey: REVERSE_SCRIPT_KEY },
  };
}

function connect(fromNodeId: string, toNodeId: string, order: number, id: string): WorkflowConnection {
  return { id, fromNodeId, toNodeId, kind: 'data', order };
}

function shotPosition(origin: WorkflowPoint, row: number): WorkflowPoint {
  return { x: origin.x + PAD + SCRIPT_WIDTH + COLUMN_GAP, y: origin.y + HEADER + row * (SHOT_HEIGHT + ROW_GAP) };
}

// 逆向工程 → 新子画布：subgraph 框 + script 节点 + 每镜头一个 image 生成节点，script → 镜头连线。
export function reverseToSubgraph(project: ReverseVideoProject, origin: WorkflowPoint, ids?: ReverseIdFactory): ReverseSubgraphPlan {
  const keyId = keyedIds('reverse:' + project.id);
  const nextId = (key: string) => (ids ? ids() : keyId(key));
  const desiredBreakdown = toScriptBreakdown(project);
  const frameId = nextId('frame');
  const scriptId = nextId(REVERSE_SCRIPT_KEY);

  const shots = desiredBreakdown.shots.map((shot, row) => {
    const key = shotKey(shot.id);
    const node = createWorkflowNode(nextId(key), 'image', shotPosition(origin, row));
    node.parentId = frameId;
    return applyShotContent(node, shotContent(shot), key);
  });
  const breakdown = linkShotNodes(desiredBreakdown, new Map(desiredBreakdown.shots.map((shot, i) => [shot.id, shots[i]!.id])));

  const script = createWorkflowNode(scriptId, 'script', { x: origin.x + PAD, y: origin.y + HEADER }, {
    scriptBreakdown: breakdown,
    reverseKey: REVERSE_SCRIPT_KEY,
  });
  script.title = project.title;
  script.height = scriptHeight(breakdown.shots.length);
  script.parentId = frameId;

  const children = [script, ...shots];
  const shotsBottom = shots.length ? shots.length * (SHOT_HEIGHT + ROW_GAP) - ROW_GAP : 0;
  const frame = createWorkflowNode(frameId, REVERSE_SUBGRAPH_TYPE, { ...origin }, {
    reverseProjectId: project.id,
    collapsed: false,
    childKeys: children.map((n) => n.metadata.reverseKey!),
  });
  frame.title = project.title;
  frame.width = PAD + SCRIPT_WIDTH + COLUMN_GAP + SHOT_WIDTH + PAD;
  frame.height = HEADER + Math.max(script.height, shotsBottom) + PAD;

  const connections = shots.map((node, i) => connect(script.id, node.id, i, ids ? ids() : keyId('edge:' + node.metadata.reverseKey)));
  return { frame, children, connections };
}

// 增量同步：按 reverseKey 对应；只增改变化项，不动用户布局与已选版本，不碰无 reverseKey 的用户节点。
export function syncSubgraph(project: ReverseVideoProject, state: ReverseSubgraphState, ids?: ReverseIdFactory): ReverseSubgraphSync {
  const { frame } = state;
  const keyId = keyedIds(frame.id);
  const nextId = (key: string) => (ids ? ids() : keyId(key));
  const breakdown = toScriptBreakdown(project);
  const byKey = new Map<string, WorkflowNode>();
  for (const child of state.children) {
    const key = child.metadata.reverseKey;
    if (isManagedKey(key) && !byKey.has(key)) byKey.set(key, child);
  }

  const add: WorkflowNode[] = [];
  const update: WorkflowNode[] = [];
  const pushIfChanged = (before: WorkflowNode, after: WorkflowNode) => {
    if (stableStringify(before) !== stableStringify(after)) update.push(after);
  };

  // 新镜头排在现有镜头列下方；没有镜头时用默认列。
  const existingShots = state.children.filter((n) => n.metadata.reverseKey?.startsWith(REVERSE_SHOT_KEY_PREFIX));
  const columnX = existingShots.length ? Math.min(...existingShots.map((n) => n.position.x)) : shotPosition(frame.position, 0).x;
  let nextY = existingShots.length
    ? Math.max(...existingShots.map((n) => n.position.y + n.height)) + ROW_GAP
    : shotPosition(frame.position, 0).y;

  const legacyTextShots: string[] = [];
  const createdShotIds = new Map<string, string>();
  const shotNodes = breakdown.shots.map((shot) => {
    const key = shotKey(shot.id);
    const desired = shotContent(shot);
    const existing = byKey.get(key);
    if (existing && existing.type !== 'text') {
      const next = applyShotContent(existing, desired, key);
      pushIfChanged(existing, next);
      return next;
    }
    // 旧版逆向把镜头写成 text 节点：原位换成 image 生成节点（新 id，同 reverseKey）。
    if (existing) legacyTextShots.push(existing.id);
    const position = existing ? existing.position : { x: columnX, y: nextY };
    const node = createWorkflowNode(existing ? nextId(key + ':gen') : nextId(key), 'image', position);
    node.parentId = frame.id;
    if (!existing) nextY += node.height + ROW_GAP;
    const created = applyShotContent(node, desired, key);
    add.push(created);
    createdShotIds.set(shot.id, created.id);
    return created;
  });

  // script
  let script = byKey.get(REVERSE_SCRIPT_KEY);
  if (script) {
    const merged = applyScriptContent(script, project.title, breakdown);
    const next = createdShotIds.size
      ? { ...merged, metadata: { ...merged.metadata, scriptBreakdown: linkShotNodes(merged.metadata.scriptBreakdown!, createdShotIds, new Set(legacyTextShots)) } }
      : merged;
    pushIfChanged(script, next);
    script = next;
  } else {
    script = createWorkflowNode(nextId(REVERSE_SCRIPT_KEY), 'script', { x: frame.position.x + PAD, y: frame.position.y + HEADER }, {
      scriptBreakdown: linkShotNodes(breakdown, createdShotIds),
      reverseKey: REVERSE_SCRIPT_KEY,
    });
    script.title = project.title;
    script.height = scriptHeight(breakdown.shots.length);
    script.parentId = frame.id;
    add.push(script);
  }


  const desiredKeys = new Set([REVERSE_SCRIPT_KEY, ...breakdown.shots.map((s) => shotKey(s.id))]);
  const remove = [
    ...Array.from(byKey.entries()).filter(([key]) => !desiredKeys.has(key)).map(([, node]) => node.id),
    ...legacyTextShots,
  ];
  // 同 key 的重复节点（例如用户复制）不归逆向管理，保持不动。

  const childKeys = [REVERSE_SCRIPT_KEY, ...breakdown.shots.map((s) => shotKey(s.id))];
  const nextFrame: WorkflowNode = {
    ...frame,
    title: project.title,
    metadata: { ...frame.metadata, reverseProjectId: project.id, childKeys },
  };
  pushIfChanged(frame, nextFrame);

  const scriptId = script.id;
  const connections = shotNodes.map((node, i) => connect(scriptId, node.id, i, ids ? ids() : keyId('edge:' + node.metadata.reverseKey)));
  return { add, update, remove, connections };
}
