// ProductionSpec V1：Reverse 项目的「生产快照 + 执行契约」。
// 只做派生，不持久化第二份工程：每次从 Reverse 项目 + 已完成产物现算，
// 消费方（Remotion Adapter、渲染 Worker、外部 Agent）都读这一个结构。
import type { ReverseVideoProject } from './types';
import { msToFrame } from './temporal';

export const PRODUCTION_SPEC_SCHEMA_VERSION = 1 as const;

export type ProductionAssetSource = 'recorded' | 'generated' | 'imported';

export interface ProductionShotV1 {
  shotId: string;
  /** 1 起，决定拼接顺序。 */
  index: number;
  startFrame: number;
  durationFrames: number;
  sourceType: ProductionAssetSource;
  /** 已完成产物的 artifactId 或 path；缺失表示还没素材。 */
  assetRef?: string;
  /** 已有可定位产物时默认锁定，局部重渲染只动未锁定的镜头。 */
  locked: boolean;
}

/** 文字层（标题、卡片字）。字号按 1080p 画面像素计，渲染按 output 高度等比缩放。 */
export interface ProductionTextV1 {
  id: string;
  text: string;
  startFrame: number;
  durationFrames: number;
  position: 'top' | 'center' | 'bottom';
  size?: number;
  color?: string;
}

/** 底部字幕：固定走安全区（底边在画高 88%），带底框。 */
export interface ProductionCaptionV1 {
  id: string;
  text: string;
  startFrame: number;
  durationFrames: number;
}

/** 音频轨：voice / music / sfx。music 默认在 voice 出声时闪避（duck）。 */
export interface ProductionAudioV1 {
  id: string;
  role: 'voice' | 'music' | 'sfx';
  src: string;
  startFrame: number;
  /** 缺省表示播到素材结束或成片结束。 */
  durationFrames?: number;
  gainDb: number;
  duck?: boolean;
}

export interface ProductionSpecV1 {
  schemaVersion: typeof PRODUCTION_SPEC_SCHEMA_VERSION;
  projectId: string;
  /** 生成时的 Workflow 修订；0 表示调用方未提供。 */
  sourceRevision: number;
  output: { width: number; height: number; fps: number; durationFrames: number };
  shots: ProductionShotV1[];
  /** 以下三轨可选：Reverse 派生的 spec 不带；Agent 视频流水线的合成 spec 会带。 */
  texts?: ProductionTextV1[];
  captions?: ProductionCaptionV1[];
  audio?: ProductionAudioV1[];
  /** 文字 / 字幕要嵌入的字体（`static:` 引用或 URL），让渲染结果不依赖渲染机系统字体。 */
  font?: { src: string };
  renderer: 'remotion';
}

export interface BuildProductionSpecOptions {
  fps?: number;
  width?: number;
  height?: number;
  sourceRevision?: number;
}

export function buildProductionSpecV1(
  project: Pick<ReverseVideoProject, 'id' | 'analysis' | 'outputs'>,
  options: BuildProductionSpecOptions = {},
): ProductionSpecV1 {
  const fps = options.fps ?? 30;
  const width = options.width ?? 1920;
  const height = options.height ?? 1080;
  const shots = [...(project.analysis?.shots ?? [])].sort((left, right) => left.index - right.index);
  const rate = { num: fps, den: 1 };
  const assetFor = (shotId: string) => project.outputs
    .filter((output) => output.ownerKind === 'shot' && output.ownerId === shotId && output.status === 'completed')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  return {
    schemaVersion: PRODUCTION_SPEC_SCHEMA_VERSION,
    projectId: project.id,
    sourceRevision: options.sourceRevision ?? 0,
    output: {
      width,
      height,
      fps,
      durationFrames: Math.max(1, msToFrame(rate, project.analysis?.durationMs ?? 0, 'ceil')),
    },
    shots: shots.map((shot) => {
      const asset = assetFor(shot.id);
      const assetRef = asset?.artifactId ?? asset?.path;
      return {
        shotId: shot.id,
        index: shot.index,
        startFrame: msToFrame(rate, shot.startMs, 'round'),
        durationFrames: Math.max(1, msToFrame(rate, shot.endMs - shot.startMs, 'round')),
        sourceType: assetRef
          ? asset?.origin === 'external-file' ? 'imported' : 'recorded'
          : 'generated',
        ...(assetRef ? { assetRef } : {}),
        locked: Boolean(assetRef),
      };
    }),
    renderer: 'remotion',
  };
}

/** 结构校验；返回空数组表示可用。渲染前必须调用，避免半成品 spec 进入 Worker。 */
export function validateProductionSpec(spec: ProductionSpecV1): string[] {
  const errors: string[] = [];
  if (spec.schemaVersion !== PRODUCTION_SPEC_SCHEMA_VERSION) errors.push('schemaVersion 必须是 1');
  if (!spec.projectId) errors.push('projectId 不能为空');
  if (spec.renderer !== 'remotion') errors.push('renderer 只支持 remotion');
  for (const key of ['width', 'height', 'fps', 'durationFrames'] as const) {
    if (!Number.isFinite(spec.output?.[key]) || spec.output[key] <= 0) errors.push(`output.${key} 必须是正数`);
  }
  if (!Array.isArray(spec.shots) || spec.shots.length === 0) errors.push('shots 不能为空');
  let previousEnd = -1;
  for (const shot of spec.shots ?? []) {
    if (!shot.shotId) errors.push('shotId 不能为空');
    if (!Number.isInteger(shot.startFrame) || shot.startFrame < 0) errors.push(`${shot.shotId}: startFrame 必须是非负整数`);
    if (!Number.isInteger(shot.durationFrames) || shot.durationFrames <= 0) errors.push(`${shot.shotId}: durationFrames 必须是正整数`);
    if (shot.startFrame < previousEnd) errors.push(`${shot.shotId}: 镜头重叠或顺序错误`);
    if (!['recorded', 'generated', 'imported'].includes(shot.sourceType)) errors.push(`${shot.shotId}: sourceType 无效`);
    previousEnd = shot.startFrame + shot.durationFrames;
  }
  const timed = (kind: string, item: { id?: string; startFrame?: number; durationFrames?: number }, durationRequired: boolean) => {
    if (!item.id) errors.push(`${kind}: id 不能为空`);
    if (!Number.isInteger(item.startFrame) || (item.startFrame as number) < 0) errors.push(`${kind} ${item.id}: startFrame 必须是非负整数`);
    if ((durationRequired || item.durationFrames !== undefined) && (!Number.isInteger(item.durationFrames) || (item.durationFrames as number) <= 0)) errors.push(`${kind} ${item.id}: durationFrames 必须是正整数`);
  };
  for (const text of spec.texts ?? []) {
    timed('text', text, true);
    if (!text.text) errors.push(`text ${text.id}: text 不能为空`);
    if (!['top', 'center', 'bottom'].includes(text.position)) errors.push(`text ${text.id}: position 无效`);
  }
  for (const caption of spec.captions ?? []) {
    timed('caption', caption, true);
    if (!caption.text) errors.push(`caption ${caption.id}: text 不能为空`);
  }
  if (spec.font !== undefined && (typeof spec.font?.src !== 'string' || !spec.font.src)) errors.push('font.src 不能为空');
  for (const clip of spec.audio ?? []) {
    timed('audio', clip, false);
    if (!clip.src) errors.push(`audio ${clip.id}: src 不能为空`);
    if (!['voice', 'music', 'sfx'].includes(clip.role)) errors.push(`audio ${clip.id}: role 无效`);
    if (!Number.isFinite(clip.gainDb)) errors.push(`audio ${clip.id}: gainDb 必须是数字`);
  }
  return errors;
}
