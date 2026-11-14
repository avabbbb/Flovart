// ProductionSpec → Remotion 预览描述。保持纯函数：组件只负责画，转换逻辑可测。
import type { ProductionSpecV1 } from './productionSpec';

export type PreviewAssetKind = 'video' | 'image' | 'placeholder';

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|svg)(?:[?#]|$)/i;

export function previewAssetKind(assetRef?: string): PreviewAssetKind {
  if (!assetRef) return 'placeholder';
  if (VIDEO_EXT.test(assetRef)) return 'video';
  if (IMAGE_EXT.test(assetRef)) return 'image';
  return 'placeholder';
}

export interface PreviewSequence {
  shotId: string;
  index: number;
  from: number;
  durationInFrames: number;
  kind: PreviewAssetKind;
  src?: string;
  label?: string;
}

/** 每个镜头一个 Sequence；没有可定位素材时给占位，不伪造画面。 */
export function toPreviewSequences(
  spec: ProductionSpecV1,
  labels: Readonly<Record<string, string | undefined>> = {},
): PreviewSequence[] {
  return spec.shots.map(shot => ({
    shotId: shot.shotId,
    index: shot.index,
    from: shot.startFrame,
    durationInFrames: shot.durationFrames,
    kind: previewAssetKind(shot.assetRef),
    ...(shot.assetRef ? { src: shot.assetRef } : {}),
    ...(labels[shot.shotId] ? { label: labels[shot.shotId] } : {}),
  }));
}

/** Node 渲染时本地素材被链接进 bundle 的 publicDir，引用写成 `static:<文件名>`；组件用 staticFile 解析。 */
export const STATIC_ASSET_PREFIX = 'static:';

export function isStaticAssetRef(src: string) {
  return src.startsWith(STATIC_ASSET_PREFIX);
}

export function dbToLinearVolume(gainDb: number) {
  // Remotion 的音量上限是 1：正增益在这里封顶，需要放大的素材请走 ffmpeg 引擎。
  return Math.min(1, Math.max(0, 10 ** (gainDb / 20)));
}

/** music 在任意 voice 出声的帧闪避到 25%（与 ffmpeg sidechain 的方向一致，力度是固定值）。 */
export const MUSIC_DUCK_FACTOR = 0.25;

export function voiceActiveAt(frame: number, audio: ReadonlyArray<{ role: string; startFrame: number; durationFrames?: number }>, totalFrames: number) {
  return audio.some(clip => clip.role === 'voice'
    && frame >= clip.startFrame
    && frame < clip.startFrame + (clip.durationFrames ?? totalFrames - clip.startFrame));
}

/** 文字层与字幕的版式：与 ffmpeg 引擎同一套比例（top 10%、bottom 底边 78%、字幕底边 88%）。 */
export function overlayLayout(position: 'top' | 'center' | 'bottom', height: number) {
  if (position === 'top') return { top: Math.round(height * 0.10) };
  if (position === 'bottom') return { bottom: Math.round(height * 0.22) };
  return { top: '50%', transform: 'translateY(-50%)' } as const;
}
