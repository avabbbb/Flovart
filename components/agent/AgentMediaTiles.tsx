// 消息与输入区里的画布素材卡：图片 = 缩略图，视频 = 封面 + 播放角标 + 时长，下方节点名 + 类型图标；
// 节点已删除时显示占位。点卡片在画布上定位节点。多张换行排列，超出收成「+N」。
import { Film, ImageIcon, ImageOff, Play, Type, X } from 'lucide-react';
import { useWorkflowMediaUrl } from '../workflow/media';
import type { WorkflowNode } from '../workflow/types';
import { formatMediaDuration, visibleTiles, type AgentMessageReference } from './agentMessageRefs';
import '../../styles/agentWorking.css';

type Lang = 'en' | 'zho';

export function findReferenceNode(ref: Pick<AgentMessageReference, 'id' | 'kind' | 'label'>, nodes: readonly WorkflowNode[] | undefined): WorkflowNode | undefined {
  if (!nodes || ref.kind !== 'node') return undefined;
  return (ref.id ? nodes.find(node => node.id === ref.id) : undefined) ?? (ref.id ? undefined : nodes.find(node => node.title === ref.label));
}

function useNodeThumb(node: WorkflowNode | undefined): string | undefined {
  const meta = node?.metadata;
  const isImage = node?.type === 'image';
  const isVideo = node?.type === 'video';
  const image = useWorkflowMediaUrl(isImage ? meta?.storageKey : undefined, isImage ? meta?.href : undefined, isImage ? meta?.artifactRef : undefined);
  const poster = useWorkflowMediaUrl(isVideo ? meta?.posterStorageKey : undefined, isVideo ? meta?.poster : undefined);
  return isImage ? image.url : isVideo ? poster.url : undefined;
}

function TypeIcon({ node, size }: { node?: WorkflowNode; size: number }) {
  if (!node) return <ImageOff size={size} />;
  if (node.type === 'video') return <Film size={size} />;
  if (node.type === 'image') return <ImageIcon size={size} />;
  return <Type size={size} />;
}

export function AgentMediaTiles({ refs, nodes, max = 6, language = 'zho', onOpen, onRemove, testId }: {
  refs: readonly AgentMessageReference[];
  nodes?: readonly WorkflowNode[];
  max?: number;
  language?: Lang;
  onOpen?: (ref: AgentMessageReference) => void;
  onRemove?: (ref: AgentMessageReference) => void;
  testId?: string;
}) {
  if (!refs.length) return null;
  const { shown, overflow } = visibleTiles(refs, max);
  const en = language === 'en';
  return (
    <div className="agent-media-tiles" data-testid={testId} aria-label={en ? 'Referenced media' : '引用的素材'}>
      {shown.map(ref => <MediaTile key={ref.kind + ':' + (ref.id || ref.label)} refItem={ref} node={findReferenceNode(ref, nodes)} language={language} onOpen={onOpen} onRemove={onRemove} />)}
      {overflow > 0 && <span className="agent-media-tile is-overflow" title={refs.slice(shown.length).map(ref => ref.label).join('、')}><span className="agent-media-tile__thumb">+{overflow}</span></span>}
    </div>
  );
}

function MediaTile({ refItem, node, language, onOpen, onRemove }: { refItem: AgentMessageReference; node?: WorkflowNode; language: Lang; onOpen?: (ref: AgentMessageReference) => void; onRemove?: (ref: AgentMessageReference) => void }) {
  const thumb = useNodeThumb(node);
  const en = language === 'en';
  const missing = refItem.kind === 'node' && !node;
  const duration = node?.type === 'video' ? formatMediaDuration(node.metadata?.durationMs) : '';
  const label = node?.title || refItem.label;
  const title = missing ? (en ? `${label} (removed from canvas)` : `${label}（节点已不在画布上）`) : label;
  return (
    <span className="agent-media-tile" data-missing={missing ? '' : undefined} data-kind={node?.type}>
      <button type="button" className="agent-media-tile__open" title={title} aria-label={(en ? 'Locate ' : '定位 ') + label} disabled={missing || !onOpen} onClick={() => onOpen?.(refItem)}>
        <span className="agent-media-tile__thumb">
          {thumb ? <img src={thumb} alt="" draggable={false} loading="lazy" /> : <TypeIcon node={missing ? undefined : node} size={16} />}
          {node?.type === 'video' && <span className="agent-media-tile__play" aria-hidden="true"><Play size={9} fill="currentColor" /></span>}
          {duration && <span className="agent-media-tile__duration">{duration}</span>}
        </span>
        <span className="agent-media-tile__label"><TypeIcon node={missing ? undefined : node} size={10} /><span>{label}</span></span>
      </button>
      {onRemove && <button type="button" className="agent-media-tile__remove" aria-label={(en ? 'Remove ' : '移除引用 ') + label} onClick={() => onRemove(refItem)}><X size={10} /></button>}
    </span>
  );
}

/** 正文里的 @名称：小缩略图胶囊。 */
export function AgentMentionPill({ label, node, onOpen }: { label: string; node?: WorkflowNode; onOpen?: () => void }) {
  const thumb = useNodeThumb(node);
  return (
    <button type="button" className="agent-mention-pill" data-missing={node ? undefined : ''} title={node ? label : label + '（节点已不在画布上）'} disabled={!node || !onOpen} onClick={onOpen}>
      {thumb ? <img src={thumb} alt="" draggable={false} /> : <TypeIcon node={node} size={11} />}
      <span>{label}</span>
    </button>
  );
}
