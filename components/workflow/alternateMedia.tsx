import { Images, Play } from 'lucide-react';
import { useWorkflowMediaUrl } from './media';
import type { WorkflowMediaAlternate } from './types';

/** 备选的预览图：图片取原图，视频取封面（没有封面时显示占位图标）。网格与叠放共用。 */
export function useAlternatePreviewUrl(alternate: WorkflowMediaAlternate | undefined) {
  const video = alternate?.type === 'video';
  return useWorkflowMediaUrl(
    !alternate ? undefined : video ? alternate.metadata.posterStorageKey : alternate.metadata.storageKey,
    !alternate ? undefined : video ? alternate.metadata.poster : alternate.metadata.href,
    !alternate || video ? undefined : alternate.metadata.artifactRef,
  ).url;
}

export function formatDuration(ms?: number) {
  if (!ms || !Number.isFinite(ms)) return '';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function AlternateThumb({ alternate }: { alternate: WorkflowMediaAlternate }) {
  const video = alternate.type === 'video';
  const url = useAlternatePreviewUrl(alternate);
  return (
    <>
      {url
        ? <img className="workflow-alternates__media" src={url} alt="" draggable={false} loading="lazy" />
        : <span className="workflow-alternates__media workflow-alternates__media--empty" aria-hidden="true">{video ? <Play size={14} /> : <Images size={14} />}</span>}
      {video && <span className="workflow-alternates__video-mark" aria-hidden="true"><Play size={9} fill="currentColor" />{formatDuration(alternate.metadata.durationMs)}</span>}
    </>
  );
}

