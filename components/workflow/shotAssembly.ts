// P2 把片子做完：长视频拆镜、按镜号拼接前的就绪检查、失败后的有限次改写重试。
// 纯函数：不碰网络与画布；拼接复用 video.merge@1（executeVideoMerge 已按 shot.index 排序），
// 重试分类复用 WorkflowExecutionError.code。
import type { ProductionBible } from './productionBible';

/** 常见视频模型单段上限（Seedance / Kling 等多为 5–15s）；调用方可按模型覆盖。 */
export const DEFAULT_MAX_SEGMENT_SEC = 15;

export interface ShotSegment {
  /** 拼接顺序，1 起。 */
  order: number;
  shotIndex: number;
  part: number;
  parts: number;
  durationSec: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** 把总时长切成不超过上限的等长段：60s / 15s → 4 × 15s；62s → 5 × 12.4s。 */
export function splitDuration(totalSec: number, maxSegmentSec = DEFAULT_MAX_SEGMENT_SEC): number[] {
  if (!(totalSec > 0) || !(maxSegmentSec > 0)) return [];
  const parts = Math.ceil(totalSec / maxSegmentSec - 1e-9);
  const each = round2(totalSec / parts);
  const out = Array.from({ length: parts }, () => each);
  out[parts - 1] = round2(totalSec - each * (parts - 1));
  return out;
}

/** 镜头表 → 生成段：超过上限的镜头拆成多段，缺时长的镜头按上限单段处理。按镜号排序。 */
export function planShotSegments(
  shots: ReadonlyArray<{ index: number; durationSec?: number }>,
  maxSegmentSec = DEFAULT_MAX_SEGMENT_SEC,
): ShotSegment[] {
  const segments: ShotSegment[] = [];
  for (const shot of [...shots].sort((left, right) => left.index - right.index)) {
    const durations = splitDuration(shot.durationSec && shot.durationSec > 0 ? shot.durationSec : maxSegmentSec, maxSegmentSec);
    durations.forEach((durationSec, position) => {
      segments.push({ order: segments.length + 1, shotIndex: shot.index, part: position + 1, parts: durations.length, durationSec });
    });
  }
  return segments;
}

export interface AssemblyPlan {
  ready: boolean;
  /** 按镜号排序、已有媒体的镜头节点，直接作 video.merge@1 的 sourceNodeIds。 */
  sourceNodeIds: string[];
  missingShots: number[];
  durationSec: number;
  blockers: string[];
}

/** 拼接前检查：所有镜头都有媒体、镜号无重复、至少 2 段才可拼接。 */
export function planAssembly(bible: Pick<ProductionBible, 'shots'>): AssemblyPlan {
  const shots = [...bible.shots].sort((left, right) => left.index - right.index);
  const blockers: string[] = [];
  const seen = new Set<number>();
  for (const shot of shots) {
    if (seen.has(shot.index)) blockers.push('镜号 ' + shot.index + ' 重复，拼接顺序不确定');
    seen.add(shot.index);
  }
  const missingShots = shots.filter(shot => !shot.hasMedia).map(shot => shot.index);
  if (missingShots.length) blockers.push('镜头 ' + missingShots.join('、') + ' 尚无视频');
  const sourceNodeIds = shots.filter(shot => shot.hasMedia).map(shot => shot.nodeId);
  if (sourceNodeIds.length < 2) blockers.push('至少需要 2 段已生成的镜头才能拼接');
  const durationSec = round2(shots.reduce((sum, shot) => sum + (shot.durationSec || 0), 0));
  return { ready: blockers.length === 0, sourceNodeIds, missingShots, durationSec, blockers };
}

export type RetryAction = 'rewrite' | 'retry' | 'abort';

const MODERATION_RE = /审核|敏感|违规|内容安全|moderation|content[ _-]?policy|safety|nsfw/i;
const TRANSIENT_RE = /超时|timeout|timed out|429|rate[ _-]?limit|限流|繁忙|busy|\b5\d\d\b|network|网络|ECONNRESET/i;

/**
 * 失败分类（保守）：审核不过 → 改写重试；瞬时错误 → 原样重试；
 * 提交结果未知（可能已扣费）、版本冲突、输入问题 → 不重试，交给人。
 */
export function classifyFailure(code: string | undefined, message: string): RetryAction {
  if (code === 'SEEDANCE_SUBMISSION_UNKNOWN' || code === 'REVISION_CONFLICT') return 'abort';
  if (code === 'INPUT_RESOLUTION_FAILED' || code === 'RESOURCE_NOT_EXECUTABLE' || code === 'UNSUPPORTED_INPUT_MODE') return 'abort';
  if (MODERATION_RE.test(message)) return 'rewrite';
  if ((code === 'PROVIDER_REQUEST_FAILED' || code === 'RUN_FAILED' || !code) && TRANSIENT_RE.test(message)) return 'retry';
  return 'abort';
}

const RISKY_TERMS = /血腥|暴力|裸露|色情|枪击|斩首|自杀|\b(gore|bloody|nude|naked|nsfw)\b/gi;

/** 确定性改写：去掉高风险词并追加中性约束；不调 LLM，结果可审计。 */
export function rewritePromptForRetry(prompt: string, attempt: number): string {
  const cleaned = prompt.replace(RISKY_TERMS, '').replace(/\s{2,}/g, ' ').trim();
  return cleaned + '\n（第 ' + attempt + ' 次安全改写：用中性画面描述，避免暴力、血腥、裸露与真实人物肖像）';
}

export interface RetryDecision {
  action: RetryAction;
  attempt: number;
  prompt?: string;
  /** 写入 note 回执的一句话。 */
  note: string;
}

/** attempt 为即将进行的第几次重试（1 起）；超过 maxRetries 一律 abort。 */
export function decideRetry(input: { code?: string; message: string; prompt: string; attempt: number; maxRetries?: number }): RetryDecision {
  const maxRetries = input.maxRetries ?? 2;
  const action = classifyFailure(input.code, input.message);
  if (action === 'abort' || input.attempt > maxRetries) {
    const reason = action === 'abort' ? '不可自动重试' : '已达重试上限 ' + maxRetries;
    return { action: 'abort', attempt: input.attempt, note: '生成失败（' + (input.code || 'UNKNOWN') + '），' + reason + '：' + input.message };
  }
  if (action === 'rewrite') {
    return { action, attempt: input.attempt, prompt: rewritePromptForRetry(input.prompt, input.attempt), note: '审核未通过，改写提示词后第 ' + input.attempt + ' 次重试' };
  }
  return { action, attempt: input.attempt, prompt: input.prompt, note: '瞬时错误，原提示词第 ' + input.attempt + ' 次重试' };
}
