import type { WorkflowAnchorKind } from '../../components/workflow/types';

// 逆向工作台数据模型。对照 Hypit 的设计（Narrative 锚点 → 转写证据 → 对齐 → 显式产物复用），
// 全部自行实现：Hypit 许可（附加条件的 Apache-2.0）与本仓库 MIT 不兼容，不引入其代码。
// 只描述工作台状态；真正的生成仍走 Workflow 节点 / production.dry-run → approve → run。

export type ReverseDirection = 'video';
export type ReverseStatus = 'draft' | 'analyzing' | 'ready' | 'generating' | 'review' | 'done' | 'error';

// ── Reference
export type ReverseReferenceKind = 'video-url' | 'video-file' | 'workflow-node';

export interface ReverseReference {
  id: string;
  kind: ReverseReferenceKind;
  label: string;
  // URL、本地相对路径或 Workflow 节点 id，按 kind 解释。
  locator: string;
  importedAt: string;
  // 人工/Agent 写的参考笔记。
  notes?: string;
}

// ── Narrative：只有 token 顺序与语义锚点，不含秒
export type ReverseSegmentRole = 'hook' | 'problem' | 'solution' | 'proof' | 'cta' | 'other';

export interface ReverseNarrativeToken {
  id: string;
  segmentId: string;
  text: string;
  // NFKC + 小写 + 去标点，用于对齐。
  normalized: string;
  speaker?: string;
  // 原文展示形态：紧贴词的标点 / 连字符随词保留，只用于台词输出。
  surface?: string;
  // 与下一个 token 之间没有空白（如 one-tap），拼接时不加空格。
  joinNext?: boolean;
}

export interface ReverseNarrativeSegment {
  id: string;
  role: ReverseSegmentRole;
  tokenStart: number;
  // 不含。
  tokenEnd: number;
}

// 半开区间 [startToken, endToken)，值为 token 边界序号；承载解释/对比。
export interface ReverseSelection {
  id: string;
  startToken: number;
  endToken: number;
}

// token 边界序号（= tokens.length 表示末尾）；承载答案/包袱。
export interface ReverseMoment {
  id: string;
  atToken: number;
}

export interface ReverseNarrative {
  id: string;
  tokens: ReverseNarrativeToken[];
  segments: ReverseNarrativeSegment[];
  selections: ReverseSelection[];
  moments: ReverseMoment[];
}

export interface ReverseScriptDiagnostic {
  line: number;
  message: string;
}

// 镜头/事件响应的语义对象；换词或换语速后，时间跟着意思走。
export interface ReverseCue {
  kind: 'selection' | 'moment' | 'segment';
  id: string;
}

// ── Speech evidence / alignment
// 转写证据词，时间在输入媒体自己的时钟上；缺失时间保持缺失，不推成静音。
export interface ReverseTranscriptWord {
  text: string;
  startMs?: number;
  endMs?: number;
  score?: number;
}

export interface ReverseTranscript {
  language?: string;
  source: 'manual' | 'whisperx' | 'hypit.transcript' | 'audio.transcribe' | 'agent';
  words: ReverseTranscriptWord[];
  importedAt: string;
}

export type ReverseAlignRelation = 'exact' | 'split' | 'merge' | 'replacement' | 'omission' | 'insertion';

export interface ReverseTokenTiming {
  tokenId: string;
  startMs: number;
  endMs: number;
  // false：由相邻实测词插值得到。
  measured: boolean;
}

export interface ReverseAlignment {
  // 与 narrative.tokens 一一对应、同序。
  timings: ReverseTokenTiming[];
  exactRatio: number;
  alignedAt: string;
}

// ── Video analysis（参考事实，毫秒在参考媒体时钟上）
export interface ReverseWord {
  // 词在全稿中的序号。
  index: number;
  text: string;
  startMs?: number;
  endMs?: number;
  speaker?: string;
  surface?: string;
  joinNext?: boolean;
}

export interface ReverseScriptSegment {
  id: string;
  role: ReverseSegmentRole;
  speaker?: string;
  text: string;
  // [firstWordIndex, lastWordIndex]，闭区间。
  wordRange?: [number, number];
}

export interface ReverseShot {
  id: string;
  // 1 起，决定拼接顺序。
  index: number;
  startMs: number;
  endMs: number;
  keyframeLocator?: string;
  camera?: string;
  description?: string;
  segmentId?: string;
  // 这一切响应的语义对象；目标版按它重定时。
  cue?: ReverseCue;
  // 该镜头内可替换位。
  slotIds: string[];
}

// 参考的可定位实现记录（对应 Hypit 的 TIMELINE.md 一节）。
export interface ReverseTimelineNote {
  id: string;
  startMs: number;
  endMs: number;
  title: string;
  note: string;
}

export interface ReverseVideoAnalysis {
  durationMs: number;
  shots: ReverseShot[];
  // 由 narrative + alignment 派生，供镜头表/Workflow 投影使用。
  words: ReverseWord[];
  segments: ReverseScriptSegment[];
  // 参考转写稿（可含 @{选区} / @{时刻!} 标记）。
  script?: string;
  narrative?: ReverseNarrative;
  transcript?: ReverseTranscript;
  alignment?: ReverseAlignment;
  // 整体理解（对应 ANALYSIS.md）。
  notes?: string;
  timelineNotes?: ReverseTimelineNote[];
  pacing?: { avgShotMs: number; hookMs: number };
  analyzedAt: string;
  source: 'manual' | 'media.analyze' | 'audio.transcribe' | 'alignment' | 'agent';
}

// ── Slots / variants
export type ReverseSlotKind = 'character' | 'product' | 'copy' | 'broll' | 'voice' | 'music' | 'asset';

export interface ReverseSlot {
  id: string;
  kind: ReverseSlotKind;
  label: string;
  // 原作中的内容描述（只作规格，不作图生图输入）。
  original?: string;
  // 替换值：文本、提示词或已批准锚点节点 id。
  replacement?: string;
  anchorNodeId?: string;
  locked?: boolean;
}

export interface ReverseVariantAxis {
  id: string;
  // 例：hook / script / broll / cta。
  label: string;
  // 该轴作用的槽位或段。
  targets: Array<{ kind: 'slot' | 'segment'; id: string }>;
  options: ReverseVariantOption[];
}

export interface ReverseVariantOption {
  id: string;
  label: string;
  value: string;
}

// 矩阵展开后的单个组合；key 为 axisId → optionId。
export interface ReverseVariant {
  id: string;
  picks: Record<string, string>;
  enabled: boolean;
}

// ── Outputs / gates
// 产物来源：本次新生成 / 工作区外部文件（保持活引用）/ 引用早先产物。
export type ReverseOutputOrigin = 'generated' | 'external-file' | 'reused';

export interface ReverseOutputRef {
  id: string;
  // 产出属于哪个变体、镜头或锚点。
  ownerKind: 'variant' | 'shot' | 'anchor';
  ownerId: string;
  // 输入内容 key；key 相同才可作为候选复用。
  key?: string;
  origin?: ReverseOutputOrigin;
  workflowNodeId?: string;
  path?: string;
  createdAt: string;
  // 复用自其他产出。
  reusedFrom?: string;
}

export type ReverseGateKind = 'anchor-approval' | 'layout' | 'budget' | 'aigc-label';
export type ReverseGateStatus = 'pending' | 'passed' | 'failed' | 'waived';

export interface ReverseGate {
  id: string;
  kind: ReverseGateKind;
  targetId: string;
  status: ReverseGateStatus;
  // 0..1 的检查分数（如有）。
  score?: number;
  threshold?: number;
  message?: string;
  checkedAt?: string;
}

export interface ReverseAnchor {
  id: string;
  kind: WorkflowAnchorKind;
  label: string;
  workflowNodeId?: string;
  approved: boolean;
}

// ── Project
interface ReverseProjectBase {
  id: string;
  title: string;
  status: ReverseStatus;
  references: ReverseReference[];
  anchors: ReverseAnchor[];
  outputs: ReverseOutputRef[];
  gates: ReverseGate[];
  // 用户目标、事实、约束与已同意的付费范围（Brief）。
  brief?: string;
  // 对 Brief 的创作方案（Treatment）。
  treatment?: string;
  // 绑定的 Workflow 项目；生成到 Workflow 时写入。
  workflowProjectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReverseVideoProject extends ReverseProjectBase {
  direction: 'video';
  analysis?: ReverseVideoAnalysis;
  // 目标稿（含与参考同名的选区/时刻）；镜头 cue 在此重新定位。
  targetScript?: string;
  slots: ReverseSlot[];
  axes: ReverseVariantAxis[];
  variants: ReverseVariant[];
}

export type ReverseProject = ReverseVideoProject;
