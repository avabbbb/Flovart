import type { ScriptBreakdown, ScriptShot } from '../../components/workflow/types';
import { alignNarrativeToTranscript } from './align';
import { narrativeWords, parseReverseScript } from './narrative';
import type {
  ReverseAlignment,
  ReverseNarrative,
  ReverseOutputRef,
  ReverseScriptDiagnostic,
  ReverseShot,
  ReverseTranscript,
  ReverseVariant,
  ReverseVariantAxis,
  ReverseVideoProject,
  ReverseWord,
} from './types';

const CJK_CHAR = '\u3400-\u9fff\uf900-\ufaff';
const TOKEN_RE = new RegExp('[' + CJK_CHAR + ']|[^' + String.fromCharCode(92) + 's' + CJK_CHAR + ']+', 'g');
const SINGLE_CJK_RE = new RegExp('^[' + CJK_CHAR + ']$');
const CJK_PUNCT = String.fromCharCode(0x3000) + '-' + String.fromCharCode(0x303f) + String.fromCharCode(0xff01) + '-' + String.fromCharCode(0xff60);
const ENDS_CJK_RE = new RegExp('[' + CJK_CHAR + CJK_PUNCT + ']$');

// 从切点（ms）生成连续镜头表；切点去重、排序并裁到 (0, durationMs)。
export function buildShotsFromCuts(cutsMs: readonly number[], durationMs: number): ReverseShot[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];
  const cuts = Array.from(new Set(cutsMs.map(Math.round)))
    .filter((ms) => ms > 0 && ms < durationMs)
    .sort((a, b) => a - b);
  const edges = [0, ...cuts, Math.round(durationMs)];
  const shots: ReverseShot[] = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    shots.push({ id: 'shot-' + (i + 1), index: i + 1, startMs: edges[i]!, endMs: edges[i + 1]!, slotIds: [] });
  }
  return shots;
}

// 旧入口：无标记纯文本切词。新流程用 parseReverseScript。
export function tokenizeScript(text: string, speaker?: string): ReverseWord[] {
  const tokens = text.match(TOKEN_RE) ?? [];
  return tokens.map((token, index) => (speaker ? { index, text: token, speaker } : { index, text: token }));
}

// 按词中点落在镜头内划分；返回闭区间 [first, last]，无定时词或无命中返回 null。
export function wordRangeForShot(words: readonly ReverseWord[], shot: Pick<ReverseShot, 'startMs' | 'endMs'>): [number, number] | null {
  let first = -1;
  let last = -1;
  for (const word of words) {
    if (word.startMs === undefined || word.endMs === undefined) continue;
    const mid = (word.startMs + word.endMs) / 2;
    if (mid < shot.startMs || mid >= shot.endMs) continue;
    if (first < 0 || word.index < first) first = word.index;
    if (word.index > last) last = word.index;
  }
  return first < 0 ? null : [first, last];
}

export function wordsText(words: readonly ReverseWord[], range: [number, number] | null | undefined): string {
  if (!range) return '';
  const picked = words.filter((w) => w.index >= range[0] && w.index <= range[1]).sort((a, b) => a.index - b.index);
  let out = '';
  let joined = false;
  for (const w of picked) {
    const glue = out.length === 0 || joined || (SINGLE_CJK_RE.test(w.text) && ENDS_CJK_RE.test(out)) ? '' : ' ';
    out += glue + (w.surface ?? w.text);
    joined = w.joinNext === true;
  }
  return out;
}

// ── 参考理解：脚本 + 转写证据 → Narrative + 对齐
export interface ReferenceReading {
  narrative: ReverseNarrative;
  alignment: ReverseAlignment;
  words: ReverseWord[];
  diagnostics: ReverseScriptDiagnostic[];
}

// 有转写证据就按证据实测定时；没有就在时长内按字长摊开并标记为未实测。
export function readReference(script: string, durationMs: number, transcript?: ReverseTranscript, now = new Date().toISOString()): ReferenceReading {
  const { narrative, diagnostics } = parseReverseScript(script);
  const result = alignNarrativeToTranscript(narrative.tokens, transcript?.words ?? [], { durationMs });
  const alignment: ReverseAlignment = { timings: result.timings, exactRatio: result.exactRatio, alignedAt: now };
  return { narrative, alignment, words: narrativeWords(narrative, result.timings), diagnostics };
}

// ── 目标重定时：实现已迁到 projection.ts（L3 叙事投影），这里保留原导出名。
export { retimeShots } from './projection';
export type { ShotWindow } from './projection';

// ── 变体矩阵
export const DEFAULT_VARIANT_LIMIT = 64;

export function variantIdFor(picks: Record<string, string>): string {
  return 'v:' + Object.keys(picks).sort().map((axis) => axis + '=' + picks[axis]).join('|');
}

export interface VariantExpansion {
  variants: ReverseVariant[];
  // 笛卡尔积总数；大于 variants.length 表示被 limit 截断。
  total: number;
  truncated: boolean;
}

// 变体矩阵展开。id 由 picks 稳定生成，重新展开时保留已有变体的 enabled。
// 空轴（无选项）忽略；没有任何有效轴时返回单个原版变体。
export function expandVariantMatrix(
  axes: readonly ReverseVariantAxis[],
  existing: readonly ReverseVariant[] = [],
  limit = DEFAULT_VARIANT_LIMIT,
): VariantExpansion {
  const live = axes.filter((axis) => axis.options.length > 0);
  const total = live.reduce((n, axis) => Math.imul(n, axis.options.length), 1);
  const enabledById = new Map(existing.map((v) => [v.id, v.enabled]));
  const variants: ReverseVariant[] = [];
  const cursor = live.map(() => 0);
  const count = Math.min(total, Math.max(0, limit));
  for (let n = 0; n < count; n += 1) {
    const picks: Record<string, string> = {};
    live.forEach((axis, i) => { picks[axis.id] = axis.options[cursor[i]!]!.id; });
    const id = variantIdFor(picks);
    variants.push({ id, picks, enabled: enabledById.get(id) ?? true });
    for (let i = live.length - 1; i >= 0; i -= 1) {
      cursor[i] = cursor[i]! + 1;
      if (cursor[i]! < live[i]!.options.length) break;
      cursor[i] = 0;
    }
  }
  return { variants, total, truncated: total > count };
}

export interface ShotRenderPlan {
  // 同 key 的镜头内容完全相同，只生成一次。
  key: string;
  shotId: string;
  variantIds: string[];
}

function relevantAxes(shot: ReverseShot, axes: readonly ReverseVariantAxis[]): ReverseVariantAxis[] {
  return axes
    .filter((axis) => axis.targets.some((t) => (t.kind === 'slot' ? shot.slotIds.includes(t.id) : t.id === shot.segmentId)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// 只有作用到该镜头槽位或所属段的轴参与 key，其余变体共用同一镜头产出。
export function planShotRenders(project: Pick<ReverseVideoProject, 'analysis' | 'axes' | 'variants'>): ShotRenderPlan[] {
  const shots = project.analysis?.shots ?? [];
  const enabled = project.variants.filter((v) => v.enabled);
  const plans = new Map<string, ShotRenderPlan>();
  for (const shot of shots) {
    const relevant = relevantAxes(shot, project.axes).map((axis) => axis.id);
    for (const variant of enabled) {
      const key = shot.id + '#' + relevant.map((axisId) => axisId + '=' + (variant.picks[axisId] ?? '')).join('|');
      const plan = plans.get(key);
      if (plan) plan.variantIds.push(variant.id);
      else plans.set(key, { key, shotId: shot.id, variantIds: [variant.id] });
    }
  }
  return Array.from(plans.values());
}

// ── Run：显式复用已有产物，只生成变化的部分
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export interface RunStep {
  // 镜头 + 相关选项 + 输入内容哈希；内容一变 key 就变，不会误复用。
  key: string;
  shotId: string;
  variantIds: string[];
  reuse?: ReverseOutputRef;
}

export interface RunPlan {
  steps: RunStep[];
  reused: number;
  toGenerate: number;
}

/** 登记待生成的镜头计划：去重、标 planned、记录归属项目；不写任何完成语义。 */
export function appendPlannedOutputs(
  outputs: readonly ReverseOutputRef[],
  steps: readonly RunStep[],
  options: { workflowProjectId?: string; workflowNodeId?: string; now: string; createId: () => string },
): ReverseOutputRef[] {
  const known = new Set(outputs.filter((o) => o.ownerKind === 'shot' && o.key).map((o) => o.key as string));
  const added = steps
    .filter((step) => !known.has(step.key))
    .map((step): ReverseOutputRef => ({
      id: options.createId(),
      ownerKind: 'shot',
      ownerId: step.shotId,
      key: step.key,
      status: 'planned',
      origin: 'generated',
      ...(options.workflowProjectId ? { workflowProjectId: options.workflowProjectId } : {}),
      ...(options.workflowNodeId ? { workflowNodeId: options.workflowNodeId } : {}),
      createdAt: options.now,
    }));
  return added.length ? [...outputs, ...added] : [...outputs];
}

export function planRun(project: Pick<ReverseVideoProject, 'analysis' | 'axes' | 'variants' | 'slots' | 'outputs' | 'workflowProjectId'>, dialogueFor?: (shot: ReverseShot) => string): RunPlan {
  const shots = new Map((project.analysis?.shots ?? []).map((s) => [s.id, s] as const));
  const words = project.analysis?.words ?? [];
  const steps = planShotRenders(project).map((plan): RunStep => {
    const shot = shots.get(plan.shotId);
    const variant = project.variants.find((v) => v.id === plan.variantIds[0]);
    const inputs = shot
      ? {
          slots: project.slots.filter((s) => shot.slotIds.includes(s.id)).map((s) => [s.id, s.replacement ?? '', s.anchorNodeId ?? '']),
          options: relevantAxes(shot, project.axes).map((axis) => {
            const option = axis.options.find((o) => o.id === variant?.picks[axis.id]);
            return [axis.id, option?.value ?? ''];
          }),
          camera: shot.camera ?? '',
          description: shot.description ?? '',
          dialogue: dialogueFor ? dialogueFor(shot) : wordsText(words, wordRangeForShot(words, shot)),
        }
      : {};
    const key = plan.key + '@' + fnv1a(JSON.stringify(inputs));
    // 只有「已完成且产物可定位」的 output 才可复用；计划占位（planned）永不参与，
    // 否则点一次「转为画布」就会把自己的待生成步骤伪装成缓存。
    const reuse = project.outputs.find((o) => o.ownerKind === 'shot'
      && o.key === key
      && o.status === 'completed'
      && Boolean(o.path || o.artifactId)
      && (!o.workflowProjectId || !project.workflowProjectId || o.workflowProjectId === project.workflowProjectId));
    return reuse ? { key, shotId: plan.shotId, variantIds: plan.variantIds, reuse } : { key, shotId: plan.shotId, variantIds: plan.variantIds };
  });
  const reused = steps.filter((s) => s.reuse).length;
  return { steps, reused, toGenerate: steps.length - reused };
}

// 生成到 Workflow：镜头表投影成现有 ScriptBreakdown，不另建脚本模型。
export function toScriptBreakdown(project: Pick<ReverseVideoProject, 'analysis' | 'references'>): ScriptBreakdown {
  const analysis = project.analysis;
  const words = analysis?.words ?? [];
  const shots: ScriptShot[] = (analysis?.shots ?? []).map((shot) => {
    const dialogue = wordsText(words, wordRangeForShot(words, shot));
    return {
      id: shot.id,
      index: shot.index,
      durationSec: Math.round((shot.endMs - shot.startMs) / 100) / 10,
      ...(shot.camera ? { camera: shot.camera } : {}),
      ...(shot.description ? { action: shot.description } : {}),
      ...(dialogue ? { dialogue } : {}),
    };
  });
  return {
    assets: [],
    shots,
    sourceText: analysis?.segments.map((s) => s.text).join('\n') || undefined,
  };
}
