import type { WorkflowNode, WorkflowProject } from '../components/workflow/types';

// Agent turn preamble: creation mode + preferred model ride as one compact
// bracketed line ahead of the user's text, only when they differ from default.

export type AgentCreationMode = 'all' | 'image' | 'video' | 'storyboard';

export const AGENT_CREATION_MODES: readonly AgentCreationMode[] = ['all', 'image', 'video', 'storyboard'];

const CREATION_MODE_LABEL: Record<AgentCreationMode, string> = {
  all: '全能创作',
  image: '图片创作',
  video: '视频创作',
  storyboard: '剧本分镜',
};

export interface AgentPreferredModel {
  capability: 'image' | 'video';
  name: string;
}

export interface AgentTurnPreambleInput {
  creationMode: AgentCreationMode;
  preferredModel?: AgentPreferredModel | null;
}

export function buildAgentTurnPreamble({ creationMode, preferredModel }: AgentTurnPreambleInput): string {
  const parts: string[] = [];
  if (creationMode !== 'all') parts.push('[创作模式: ' + CREATION_MODE_LABEL[creationMode] + ']');
  const modelName = preferredModel?.name.trim();
  if (preferredModel && modelName) parts.push('[首选' + (preferredModel.capability === 'video' ? '视频' : '图片') + '模型: ' + modelName + ']');
  return parts.join(' ');
}

export function applyAgentTurnPreamble(text: string, input: AgentTurnPreambleInput): string {
  const preamble = buildAgentTurnPreamble(input);
  if (!preamble) return text;
  return text ? preamble + '\n' + text : preamble;
}

// Canvas to Skill: a group of nodes becomes an ordered, replayable recipe.

export interface CanvasRecipeStep {
  nodeId: string;
  type: string;
  title: string;
  model?: string;
  mode?: string;
  prompt?: string;
  params: Record<string, string | number | boolean>;
  // Titles of upstream nodes feeding this step (from project.connections).
  inputs: string[];
}

export interface CanvasRecipe {
  steps: CanvasRecipeStep[];
  layout: { columns: number };
}

export interface UserSkillRecord {
  id: string;
  name: string;
  slug: string;
  description: string;
  prompt: string;
  recipe?: CanvasRecipe;
  createdAt: string;
}

export interface UserSkillMeta {
  name: string;
  slug: string;
  description: string;
}

const RECIPE_PARAM_KEYS = [
  'aspectRatio',
  'resolution',
  'duration',
  'quality',
  'count',
  'seed',
  'size',
  'style',
  'generateAudio',
] as const;

const PROMPT_EXCERPT_LIMIT = 400;

function metadataOf(node: WorkflowNode): Record<string, unknown> {
  return (node.metadata ?? {}) as unknown as Record<string, unknown>;
}

function stringField(source: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function pickParams(source: Record<string, unknown>): CanvasRecipeStep['params'] {
  const params: CanvasRecipeStep['params'] = {};
  for (const key of RECIPE_PARAM_KEYS) {
    const value = source[key];
    if (typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && value !== '')) params[key] = value;
  }
  return params;
}

// Rows by y (nodes whose top sits within half a node height share a row), then x inside a row.
function layoutRows(nodes: WorkflowNode[]): WorkflowNode[][] {
  const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const rows: WorkflowNode[][] = [];
  let rowTop = Number.NEGATIVE_INFINITY;
  let tolerance = 0;
  for (const node of sorted) {
    const current = rows[rows.length - 1];
    if (current && node.position.y - rowTop <= tolerance) {
      current.push(node);
    } else {
      rows.push([node]);
      rowTop = node.position.y;
      tolerance = Math.max(24, (node.height || 0) / 2);
    }
  }
  return rows.map(row => row.sort((a, b) => a.position.x - b.position.x));
}

export function recipeFromNodes(project: Pick<WorkflowProject, 'nodes' | 'connections'>, nodeIds: readonly string[]): CanvasRecipe {
  const wanted = new Set(nodeIds);
  const titleById = new Map(project.nodes.map(node => [node.id, node.title || node.id]));
  const rows = layoutRows(project.nodes.filter(node => wanted.has(node.id)));
  const steps = rows.flat().map<CanvasRecipeStep>(node => {
    const meta = metadataOf(node);
    const inputs = project.connections
      .filter(connection => connection.toNodeId === node.id)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(connection => titleById.get(connection.fromNodeId))
      .filter((title): title is string => Boolean(title));
    return {
      nodeId: node.id,
      type: node.type,
      title: node.title || node.id,
      model: stringField(meta, 'productModelId', 'model'),
      mode: stringField(meta, 'mode', 'generationMode'),
      prompt: stringField(meta, 'prompt', 'text', 'content'),
      params: pickParams(meta),
      inputs,
    };
  });
  return { steps, layout: { columns: rows.reduce((max, row) => Math.max(max, row.length), 0) } };
}

export function normalizeSkillSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'skill';
}

const NODE_TYPE_LABEL: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
};

function excerpt(value: string): string {
  const flat = value.replace(/\s+/g, ' ');
  return flat.length > PROMPT_EXCERPT_LIMIT ? flat.slice(0, PROMPT_EXCERPT_LIMIT) + '…' : flat;
}

function describeStep(step: CanvasRecipeStep, index: number): string {
  const parts = [String(index + 1) + '. 创建' + (NODE_TYPE_LABEL[step.type] ?? step.type) + '节点「' + step.title + '」'];
  if (step.model) parts.push('模型 ' + step.model);
  if (step.mode) parts.push('方式 ' + step.mode);
  if (step.inputs.length) parts.push('输入：' + step.inputs.join('、'));
  const params = Object.entries(step.params).map(([key, value]) => key + '=' + String(value)).join('，');
  if (params) parts.push('参数：' + params);
  if (step.prompt) parts.push('提示词参考：' + excerpt(step.prompt));
  return parts.join('；');
}

function recipeReplayPrompt(recipe: CanvasRecipe, name: string): string {
  return [
    '按 Skill「' + name + '」复刻以下画布制作流程：用用户提供的新输入替换原内容，保持节点类型、模型、参数与连线关系不变。',
    ...recipe.steps.map(describeStep),
    '节点按 ' + Math.max(1, recipe.layout.columns) + ' 列网格排列，连线与上述输入一致；缺少必要输入时先向用户询问，付费生成前遵循当前生成模式的确认规则。',
  ].join('\n');
}

export interface UserSkillIdentity {
  id?: string;
  createdAt?: string;
}

function newSkillId(): string {
  const suffix = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Date.now().toString(36);
  return 'mine.' + suffix;
}

// A blank (hand-written) user skill.
export function createUserSkill(meta: UserSkillMeta & { prompt: string }, identity: UserSkillIdentity = {}): UserSkillRecord {
  return {
    id: identity.id ?? newSkillId(),
    name: meta.name.trim() || meta.slug.trim() || 'Skill',
    slug: normalizeSkillSlug(meta.slug || meta.name),
    description: meta.description.trim(),
    prompt: meta.prompt.trim(),
    createdAt: identity.createdAt ?? new Date().toISOString(),
  };
}

export function skillFromRecipe(recipe: CanvasRecipe, meta: UserSkillMeta, identity: UserSkillIdentity = {}): UserSkillRecord {
  const name = meta.name.trim() || meta.slug.trim() || 'Skill';
  return {
    ...createUserSkill({ ...meta, name, prompt: recipeReplayPrompt(recipe, name) }, identity),
    recipe,
  };
}
