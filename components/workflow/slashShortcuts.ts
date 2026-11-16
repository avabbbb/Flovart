/**
 * Slash 快捷工具注册表（P0-5）：画布 `/`、Prompt Bar 里的 `/` 与 Agent 的 workflow.shortcut.* 共用这一份清单，
 * 组件里不写死命令。
 *
 * "一个节点完成"：
 * - 宫格类（grid）在目标节点上原地出**一张**宫格图（count=1），之后按需用 image.split-grid@1 切分；
 * - 非宫格类（single）在源图右侧新建**一个**生成节点，模板 prompt 写进它的 Prompt Bar，源图用 @ + 连线引用。
 *
 * 宫格类原地 / 新建规则：
 * - 目标节点已经连着图片参考，或命令最少源数为 0 → 模板写进目标节点的 Prompt Bar，原位跑（placement: in-place）；
 * - 目标节点只是一张已出图、没有参考的图 → 右侧新建节点，@ + 连线引用它（placement: new-node）。
 */
import { planWorkflowGenerate, WorkflowGenerateError, type GeneratePlan } from '../../services/workflowGenerateCommand';
import type { UserApiKey } from '../../types';
import { getWorkflowInputNodes } from './references';
import type { WorkflowConnection, WorkflowNode } from './types';

export type SlashShortcutCategory = 'storyboard' | 'character' | 'camera' | 'enhance';
export type SlashShortcutPlacement = 'in-place' | 'new-node';

export interface SlashShortcut {
  /** 稳定 id：Agent 用 scene 调用，改文案不改它 */
  scene: string;
  label: string;
  labelEn: string;
  description: string;
  icon: 'grid' | 'user' | 'film' | 'sun' | 'aperture' | 'clapperboard';
  category: SlashShortcutCategory;
  mode: 'image';
  kind: 'grid' | 'single';
  /** 宫格类的行列；出图后可用 image.split-grid@1 按 rows×cols 切分 */
  grid?: { rows: number; cols: number };
  minSources: number;
  maxSources: number;
  aspectRatio?: string;
  /** 模板 prompt；`{description}` 换成节点里已有的描述（或调用方给的 text），没有就去掉这一段 */
  template: string;
}

export const SLASH_SHORTCUT_CATEGORY_LABELS: Record<SlashShortcutCategory, string> = {
  storyboard: '分镜',
  character: '角色',
  camera: '机位',
  enhance: '增强',
};

export const SLASH_SHORTCUTS: readonly SlashShortcut[] = Object.freeze([
  {
    scene: 'multi-camera-9',
    label: '多机位九宫格',
    labelEn: 'Multi-angle 3×3 grid',
    description: '1 张图 → 一张 3×3 九机位宫格图',
    icon: 'grid',
    category: 'camera',
    mode: 'image',
    kind: 'grid',
    grid: { rows: 3, cols: 3 },
    minSources: 1,
    maxSources: 1,
    aspectRatio: '1:1',
    template: 'A single 3x3 grid image (9 equal panels, thin white gutters) of the same subject from 9 different camera angles, left to right, top to bottom: front eye-level; front-left 3/4 slight high angle; left profile; back-left 3/4 slight low angle; back view; back-right 3/4 slight high angle; right profile; front-right 3/4 slight low angle; top-down bird\'s eye view. Only the camera changes: keep identical subject identity, pose, clothing, hairstyle, lighting and style in every panel.{description}',
  },
  {
    scene: 'character-3-view',
    label: '角色三视图',
    labelEn: 'Character turnaround',
    description: '1 张角色图 → 一张前 / 侧 / 后三视图',
    icon: 'user',
    category: 'character',
    mode: 'image',
    kind: 'grid',
    grid: { rows: 1, cols: 3 },
    minSources: 1,
    maxSources: 1,
    aspectRatio: '16:9',
    template: 'Character turnaround sheet in one image, three panels side by side: front view, side profile view, back view, full body T-pose. Identical character design, colors, proportions, clothing and accessories in all three; clean neutral concept-art background.{description}',
  },
  {
    scene: 'story-4-grid',
    label: '剧情推演四宫格',
    labelEn: 'Story 2×2 grid',
    description: '把描述拆成一张 2×2 四格剧情图',
    icon: 'film',
    category: 'storyboard',
    mode: 'image',
    kind: 'grid',
    grid: { rows: 2, cols: 2 },
    minSources: 0,
    maxSources: 1,
    aspectRatio: '1:1',
    template: 'A single 2x2 grid image (4 panels, thin gutters) telling one story in order: 1 opening establishing shot, 2 rising action as the conflict begins, 3 climax at the dramatic peak, 4 resolution and aftermath. Cinematic narrative, consistent characters and art style across all panels.{description}',
  },
  {
    scene: 'storyboard-25',
    label: '25宫格连贯分镜',
    labelEn: 'Storyboard 5×5 grid',
    description: '把描述拆成一张 5×5 连贯分镜图',
    icon: 'clapperboard',
    category: 'storyboard',
    mode: 'image',
    kind: 'grid',
    grid: { rows: 5, cols: 5 },
    minSources: 0,
    maxSources: 1,
    aspectRatio: '1:1',
    template: 'A single 5x5 storyboard grid image (25 sequential frames, thin gutters, read left to right, top to bottom) covering opening, development, midpoint turn, escalation, climax and resolution. Consistent characters and style across all frames, cinematic composition in every frame.{description}',
  },
  {
    scene: 'lighting-fix',
    label: '电影级光影矫正',
    labelEn: 'Cinematic relight',
    description: '修复不稳定光线，专业色彩分级（右侧新建一个节点）',
    icon: 'sun',
    category: 'enhance',
    mode: 'image',
    kind: 'single',
    minSources: 1,
    maxSources: 1,
    template: 'Same image with cinematic lighting correction and professional color grading: balanced exposure, dramatic but natural light, no harsh shadows or blown highlights. Keep composition, subject and details unchanged.{description}',
  },
  {
    scene: 'portrait-enhance',
    label: '人像质感增强',
    labelEn: 'Portrait enhance',
    description: '增强皮肤质感、光影细节（右侧新建一个节点）',
    icon: 'aperture',
    category: 'enhance',
    mode: 'image',
    kind: 'single',
    minSources: 1,
    maxSources: 1,
    template: 'Same portrait with enhanced skin texture, detailed facial features, soft studio lighting and shallow depth of field. Preserve original identity, expression and composition.{description}',
  },
] satisfies SlashShortcut[]);

export function getSlashShortcut(scene: string): SlashShortcut | undefined {
  return SLASH_SHORTCUTS.find(item => item.scene === scene);
}

export function filterSlashShortcuts(query: string, shortcuts: readonly SlashShortcut[] = SLASH_SHORTCUTS): SlashShortcut[] {
  const trimmed = query.trim();
  if (!trimmed) return [...shortcuts];
  const lower = trimmed.toLowerCase();
  return shortcuts.filter(item =>
    item.scene.includes(lower)
    || item.label.toLowerCase().includes(lower)
    || item.labelEn.toLowerCase().includes(lower)
    || item.description.toLowerCase().includes(lower)
    || SLASH_SHORTCUT_CATEGORY_LABELS[item.category].includes(trimmed));
}

/** Agent 可读的清单（workflow.shortcut.list）：不含图标 */
export function describeSlashShortcuts() {
  return SLASH_SHORTCUTS.map(item => ({
    scene: item.scene,
    label: item.label,
    labelEn: item.labelEn,
    description: item.description,
    category: item.category,
    kind: item.kind,
    ...(item.grid ? { grid: item.grid, splitTool: 'image.split-grid@1' } : {}),
    minSources: item.minSources,
    maxSources: item.maxSources,
    output: item.kind === 'grid' ? 'one grid image (count=1)' : 'one new generation node to the right',
  }));
}

export function fillShortcutTemplate(shortcut: SlashShortcut, description?: string): string {
  const extra = (description || '').trim();
  return shortcut.template.replace('{description}', extra ? ' Content: ' + extra : '');
}

export class SlashShortcutError extends Error {
  constructor(public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = 'SlashShortcutError';
  }
}

export interface ShortcutRequestInput {
  shortcut: SlashShortcut;
  nodes: readonly WorkflowNode[];
  connections: readonly WorkflowConnection[];
  /** 目标节点（Prompt Bar 所在节点或选中的节点） */
  targetId?: string;
  /** 额外描述（没有就用目标节点已有的 prompt） */
  text?: string;
  /** 没有目标节点、新建时的落位 */
  position?: { x: number; y: number };
}

export interface ShortcutRequest {
  placement: SlashShortcutPlacement;
  /** 喂给 planWorkflowGenerate 的参数（nodeId 或 type、prompt、references、count=1） */
  generateArgs: Record<string, unknown>;
  sourceIds: string[];
}

const hasImage = (node: WorkflowNode) => node.type === 'image' && Boolean(node.metadata.href || node.metadata.storageKey);
const RIGHT_GAP = 80;

/** 纯函数：按"宫格原地 / 非宫格右侧新建"规则把快捷工具翻译成一次生成请求。 */
export function resolveShortcutRequest(input: ShortcutRequestInput): ShortcutRequest {
  const { shortcut } = input;
  const target = input.targetId ? input.nodes.find(node => node.id === input.targetId) : undefined;
  if (input.targetId && !target) throw new SlashShortcutError('NOT_FOUND', '节点不存在：' + input.targetId);
  if (target?.type === 'text') throw new SlashShortcutError('NOTE_IS_ANNOTATION', '文本节点是备注，不参与生成；请对图片节点使用快捷工具。');
  if (target && target.type !== 'image') throw new SlashShortcutError('UNSUPPORTED_TARGET', `「${shortcut.label}」只用于图片节点，${target.id} 是 ${target.type}。`);
  const params = { count: 1, ...(shortcut.aspectRatio ? { aspectRatio: shortcut.aspectRatio } : {}) };
  const existingDescription = target && !hasImage(target) ? String(target.metadata.prompt || '') : '';
  const description = input.text !== undefined ? input.text : existingDescription;
  const prompt = fillShortcutTemplate(shortcut, description);
  const title = shortcut.label;

  const imageRefs = target ? getWorkflowInputNodes(target, input.nodes as WorkflowNode[], input.connections as WorkflowConnection[]).filter(node => node.type === 'image') : [];
  const inPlace = Boolean(target) && shortcut.kind === 'grid' && (imageRefs.length > 0 || (shortcut.minSources === 0 && !hasImage(target!)));
  if (target && inPlace) {
    const refs = imageRefs.slice(0, Math.max(1, shortcut.maxSources));
    if (refs.length < shortcut.minSources) throw new SlashShortcutError('NEEDS_SOURCE', `「${shortcut.label}」需要至少 ${shortcut.minSources} 张图片参考。`);
    return {
      placement: 'in-place',
      sourceIds: refs.map(node => node.id),
      generateArgs: { nodeId: target.id, prompt, references: refs.map(node => node.id), ...params },
    };
  }
  if (target) {
    // 目标是一张图（或非宫格工具）：它就是源，右侧新建一个生成节点引用它。
    if (!hasImage(target)) {
      if (shortcut.minSources === 0) {
        return { placement: 'in-place', sourceIds: [], generateArgs: { nodeId: target.id, prompt, references: [], ...params } };
      }
      const refs = imageRefs.slice(0, shortcut.maxSources);
      if (refs.length < shortcut.minSources) throw new SlashShortcutError('NEEDS_SOURCE', `「${shortcut.label}」需要一张已出图的源图：先选中一张图片，或给节点连一张参考图。`);
      return {
        placement: 'in-place',
        sourceIds: refs.map(node => node.id),
        generateArgs: { nodeId: target.id, prompt, references: refs.map(node => node.id), ...params },
      };
    }
    return {
      placement: 'new-node',
      sourceIds: [target.id],
      generateArgs: {
        type: 'image',
        title,
        prompt,
        references: [target.id],
        x: target.position.x + target.width + RIGHT_GAP,
        y: target.position.y,
        ...params,
      },
    };
  }
  if (shortcut.minSources > 0) throw new SlashShortcutError('NEEDS_SOURCE', `「${shortcut.label}」需要先选中一张已出图的图片节点。`);
  return {
    placement: 'new-node',
    sourceIds: [],
    generateArgs: { type: 'image', title, prompt, references: [], ...(input.position ? { x: input.position.x, y: input.position.y } : {}), ...params },
  };
}

export interface ShortcutApplyInput extends ShortcutRequestInput {
  mutationId: string;
  keys: UserApiKey[];
  place: (node: WorkflowNode, upstreamIds: string[]) => { x: number; y: number };
  createId?: () => string;
}

export interface ShortcutApplyPlan {
  scene: string;
  placement: SlashShortcutPlacement;
  nodeId: string;
  created: boolean;
  sourceIds: string[];
  grid?: { rows: number; cols: number };
  plan: GeneratePlan;
}

/**
 * 纯函数：快捷工具 → 一个 ChangeSet 的文档操作（新建/复用一个生成节点、连参考、写 Prompt Bar、count=1）。
 * 模型选择、@chip 文档、能力校验全部复用 planWorkflowGenerate，与 workflow.generate 同一条路。
 */
export function buildShortcutApplyOps(input: ShortcutApplyInput): ShortcutApplyPlan {
  const request = resolveShortcutRequest(input);
  let plan: GeneratePlan;
  try {
    plan = planWorkflowGenerate({
      nodes: input.nodes,
      connections: input.connections,
      args: request.generateArgs,
      mutationId: input.mutationId,
      keys: input.keys,
      place: input.place,
      createId: input.createId,
    });
  } catch (cause) {
    if (cause instanceof WorkflowGenerateError) throw new SlashShortcutError(cause.code, cause.message, cause.details);
    throw cause;
  }
  return {
    scene: input.shortcut.scene,
    placement: request.placement,
    nodeId: plan.nodeId,
    created: plan.created,
    sourceIds: request.sourceIds,
    ...(input.shortcut.grid ? { grid: input.shortcut.grid } : {}),
    plan,
  };
}
