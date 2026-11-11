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
