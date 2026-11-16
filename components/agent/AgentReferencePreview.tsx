import { FileText, Film, Image as ImageIcon } from 'lucide-react';
import { translations } from '../../utils/translations';
import { useLayoutEffect, useRef, useState } from 'react';

import type { AssetItem } from '../../types';
import { useWorkflowMediaUrl } from '../workflow/media';
import type { WorkflowNode } from '../workflow/types';
import { mediaKind } from './pickerNavigation';

// @ 引用浮层里高亮项的预览卡：与 Skill 浮层左侧预览同一套样式（磨砂玻璃、封面 + 标题 + 规格）。
// 放在浮层左侧；左侧没空间时翻到上方；都没有就不显示。视频用静音循环小预览（浏览器只解码这一路）。

interface ReferenceLike { id: string; type: 'node' | 'asset'; label: string; mediaType?: string }

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '';
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}


export function ReferencePreview({ reference, nodes, assets, language = 'zho' }: { reference: ReferenceLike; nodes: readonly WorkflowNode[]; assets: readonly AssetItem[]; language?: 'en' | 'zho' }) {
  const copy = translations[language].agentPanel;
  const ref = useRef<HTMLElement>(null);
  const [side, setSide] = useState<'left' | 'above' | 'hidden'>('left');
  const node = reference.type === 'node' ? nodes.find(item => item.id === reference.id) : undefined;
  const asset = reference.type === 'asset' ? assets.find(item => item.id === reference.id) : undefined;
  const metadata = (node?.metadata || {}) as Record<string, unknown>;
  const storageKey = typeof metadata.storageKey === 'string' ? metadata.storageKey : undefined;
  const href = asset?.dataUrl || (typeof metadata.href === 'string' ? metadata.href : undefined);
  const kind = mediaKind(asset?.mimeType || (node ? (typeof metadata.mimeType === 'string' ? metadata.mimeType : node.type) : reference.mediaType));
  const visual = kind === 'image' || kind === 'video';
  const media = useWorkflowMediaUrl(visual ? storageKey : undefined, visual ? href : undefined);
  const width = asset?.width || Number(metadata.naturalWidth || metadata.width || 0) || undefined;
  const height = asset?.height || Number(metadata.naturalHeight || metadata.height || 0) || undefined;
  const duration = Number(metadata.durationSec || 0) || (Number(metadata.durationMs || 0) / 1000) || undefined;
  const bytes = Number(metadata.bytes || 0) || undefined;
  const text = kind === 'text' ? String(metadata.content || metadata.prompt || '') : String(asset?.prompt || metadata.prompt || '');
  const specs = [copy.referenceKind[kind] || reference.mediaType || '', width && height ? `${width}×${height}` : '', formatDuration(duration), formatBytes(bytes)].filter(Boolean);

  // 预览卡位置：读所在浮层的视口位置，左侧放得下就放左边，否则上方，再不行隐藏。
  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    setSide(rect.left >= 260 ? 'left' : rect.top >= 240 ? 'above' : 'hidden');
  }, [reference.id]);

  if (side === 'hidden') return null;
  return (
    <aside ref={ref} className="agent-reference-preview skill-hub__preview" data-side={side} aria-hidden="true">
      <div className="skill-hub__preview-cover">
        {visual && media.url
          ? kind === 'video'
            ? <video src={media.url} muted autoPlay loop playsInline preload="metadata" />
            : <img src={media.url} alt="" />
          : <span className="agent-reference-preview__glyph">{kind === 'video' ? <Film size={22} /> : kind === 'text' ? <FileText size={22} /> : <ImageIcon size={22} />}</span>}
        <span className="skill-hub__badge">{reference.type === 'node' ? copy.referenceBadgeNode : copy.referenceBadgeAsset}</span>
      </div>
      <div className="skill-hub__preview-body">
        <strong>{reference.label}</strong>
        <em>{specs.join(' · ')}</em>
        {text && <p>{text}</p>}
      </div>
    </aside>
  );
}
