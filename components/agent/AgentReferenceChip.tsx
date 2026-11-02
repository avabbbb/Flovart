import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RotateCw, X } from 'lucide-react';
import { useWorkflowMediaUrl } from '../workflow/media';
import type { WorkflowNode } from '../workflow/types';

const PREVIEW_WIDTH = 240;

type Anchor = { left: number; bottom: number };

// Agent 输入框里的引用 chip：图片/视频节点显示缩略图，悬停在 chip 上方弹出预览，视频静音循环播放。
// 完整视频只在悬停时加载，平时只读封面。
export function AgentReferenceChip({ node, icon, label, targetLabel, onTarget, onReplace, onRemove }: {
  node?: WorkflowNode;
  icon: ReactNode;
  label: string;
  targetLabel: string;
  onTarget: () => void;
  onReplace: () => void;
  onRemove: () => void;
}) {
  const chipRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const meta = node?.metadata;
  const isImage = node?.type === 'image';
  const isVideo = node?.type === 'video';
  const image = useWorkflowMediaUrl(isImage ? meta?.storageKey : undefined, isImage ? meta?.href : undefined, isImage ? meta?.artifactRef : undefined);
  const poster = useWorkflowMediaUrl(isVideo ? meta?.posterStorageKey : undefined, isVideo ? meta?.poster : undefined);
  const thumbUrl = isImage ? image.url : isVideo ? poster.url : undefined;
  const previewable = isImage ? Boolean(image.url) : isVideo;

  const showPreview = () => {
    const rect = chipRef.current?.getBoundingClientRect();
    if (!rect || !previewable) return;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - PREVIEW_WIDTH - 8));
    setAnchor({ left, bottom: window.innerHeight - rect.top + 8 });
  };
  const hidePreview = () => setAnchor(null);

  return (
    <span ref={chipRef} className="agent-reference-chip" onMouseEnter={showPreview} onMouseLeave={hidePreview}>
      <button type="button" className="agent-reference-chip__target" aria-label={targetLabel} onClick={onTarget}>
        {thumbUrl
          ? <img className="agent-reference-thumb" src={thumbUrl} alt="" draggable={false} />
          : icon}
        <span>{label}</span>
      </button>
      <button type="button" aria-label={'替换引用 ' + label} onClick={onReplace}><RotateCw size={12} /></button>
      <button type="button" aria-label={'移除引用 ' + label} onClick={() => { hidePreview(); onRemove(); }}><X size={12} /></button>
      {anchor && node && createPortal(
        <div className="agent-reference-preview" role="tooltip" style={{ left: anchor.left, bottom: anchor.bottom, width: PREVIEW_WIDTH }}>
          {isVideo ? <VideoPreview node={node} poster={poster.url} /> : <img src={image.url} alt={label} draggable={false} />}
        </div>,
        document.body,
      )}
    </span>
  );
}

function VideoPreview({ node, poster }: { node: WorkflowNode; poster?: string }) {
  const video = useWorkflowMediaUrl(node.metadata.storageKey, node.metadata.href, node.metadata.artifactRef);
  if (!video.url) return poster ? <img src={poster} alt={node.title} draggable={false} /> : <div className="agent-reference-preview-empty">正在加载视频</div>;
  return <video src={video.url} poster={poster || undefined} muted autoPlay loop playsInline preload="auto" />;
}
