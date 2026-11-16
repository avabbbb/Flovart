import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type SyntheticEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Download, Images, Maximize2, Minimize2, Play, Star } from 'lucide-react';
import { FAN_SPRING, fanPose } from '../ui/ImageFan';
import { saveMediaUrl } from '../../services/desktopNetwork';
import { useWorkflowMediaUrl } from './media';
import { formatDuration, useAlternatePreviewUrl } from './alternateMedia';
import { nodeAlternates, usesAlternateStack } from './batchAlternates';
import { BATCH_GRID_GAP, batchCellCloseTransition, batchCellOffset, batchCellOpenTransition, batchCellStackedPose } from './batchStackMotion';
import type { WorkflowMediaAlternate, WorkflowNode } from './types';

/**
 * 少量多结果（总数 ≤ ALTERNATE_STACK_MAX_TOTAL）的斜叠卡片（DESIGN.md §9.5、01 §13.3）。
 *
 * 外观与交互沿用原来的批次叠放（WorkflowBatchStack / WorkflowBatchGallery）：
 * - 收起：备选在首图后面左右斜出（ImageFan 同一套姿态和弹簧），悬停散开；右上角“N 张”展开。
 * - 展开：以首图为左上角铺成 2 列网格，每格从叠放位置弹出；格子带 下载 / 设为首图，点格子进画廊；“收起”反向飞回。
 *
 * 但数据仍是一个首图节点 + metadata.alternates：整套卡片是节点 DOM 的子元素，拖节点就是拖整摞，
 * 不再有同位叠放的兄弟节点（旧的“拖走后原位残留”不会再出现）。
 */

const COLLAPSED_BOTTOM = 16;
const COLUMNS = 2;

/** 叠放在节点盒子之外占的范围（世界坐标，相对节点右缘 / 下缘）。 */
export function workflowAlternatesStackExtent(node: Pick<WorkflowNode, 'width' | 'height' | 'metadata'>, expanded: boolean) {
  const total = nodeAlternates(node).length + 1;
  if (!expanded) return { right: 0, bottom: COLLAPSED_BOTTOM };
  const columns = Math.min(COLUMNS, total);
  const rows = Math.ceil(total / COLUMNS);
  return {
    right: (columns - 1) * (node.width + BATCH_GRID_GAP),
    bottom: (rows - 1) * (node.height + BATCH_GRID_GAP),
  };
}

const stop = (event: SyntheticEvent) => event.stopPropagation();
const kindLabel = (alternate: WorkflowMediaAlternate, en: boolean) => (alternate.type === 'video' ? (en ? 'video' : '视频') : (en ? 'image' : '图片'));

function StackLayer({ alternate, slot }: { alternate: WorkflowMediaAlternate; slot: number }) {
  const url = useAlternatePreviewUrl(alternate);
  return (
    <motion.div
      className="workflow-batch-stack__layer workflow-alt-stack__layer"
      data-alternate-id={alternate.id}
      style={{ zIndex: 1 + (1 - slot) }}
      variants={{ rest: fanPose(slot, false), hover: fanPose(slot, true) }}
      transition={FAN_SPRING}
    >
      {url && <img src={url} alt="" draggable={false} />}
    </motion.div>
  );
}

function StackCell({ alternate, index, count, width, height, en, locked, reduceMotion, onPreview, onPromote }: {
  alternate: WorkflowMediaAlternate;
  /** 网格位：0 是首图（节点本身），备选从 1 开始。 */
  index: number;
  count: number;
  width: number;
  height: number;
  en: boolean;
  locked: boolean;
  reduceMotion: boolean;
  onPreview: () => void;
  onPromote: () => void;
}) {
  const url = useAlternatePreviewUrl(alternate);
  const download = useWorkflowMediaUrl(alternate.metadata.storageKey, alternate.metadata.href, alternate.type === 'video' ? undefined : alternate.metadata.artifactRef);
  const { left, top } = batchCellOffset(index, COLUMNS, width, height);
  const stacked = batchCellStackedPose(index, left, top);
  const video = alternate.type === 'video';
  // 按下后拖动过（拖的是整个节点）就不算单击，松手时不进画廊。
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const name = en ? `Result ${index + 1} (${kindLabel(alternate, en)})` : `第 ${index + 1} 个结果（${kindLabel(alternate, en)}）`;
  return (
    <motion.div
      className="workflow-batch-cell workflow-alt-stack__cell"
      data-testid="workflow-alternate-stack-cell"
      data-alternate-id={alternate.id}
      role="button"
      tabIndex={0}
      aria-label={(en ? 'Preview ' : '预览') + name}
      title={alternate.title || name}
      style={{ left, top, width, height, zIndex: count - index }}
      initial={reduceMotion ? false : stacked}
      animate={{ x: 0, y: 0, scale: 1, opacity: 1, transition: reduceMotion ? { duration: 0 } : batchCellOpenTransition(index) }}
      exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { ...stacked, transition: batchCellCloseTransition(index, count) }}
      // pointerdown 不拦（照常冒泡到节点）：按住格子拖 = 拖首图节点，整摞一起走；没拖动的单击 = 进画廊。
      onPointerDown={event => { pressRef.current = { x: event.clientX, y: event.clientY }; }}
      onClick={event => {
        event.stopPropagation();
        const press = pressRef.current;
        pressRef.current = null;
        if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 4) return;
        onPreview();
      }}
      onDoubleClick={stop}
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onPreview(); }
      }}
    >
      {url
        ? <img src={url} alt="" className="workflow-batch-cell__media" draggable={false} />
        : <span className="workflow-batch-cell__media workflow-alt-stack__empty" aria-hidden="true">{video ? <Play size={18} /> : <Images size={18} />}</span>}
      {video && <span className="workflow-alt-stack__video-mark" aria-hidden="true"><Play size={10} fill="currentColor" />{formatDuration(alternate.metadata.durationMs)}</span>}
      <div className="workflow-batch-cell__actions workflow-alt-stack__actions" data-workflow-overlay onPointerDown={stop} onClick={stop}>
        <button
          type="button"
          title={en ? 'Download' : '下载'}
          aria-label={en ? `Download ${name}` : `下载${name}`}
          disabled={!download.url}
          onClick={() => { if (!download.url) return; void saveMediaUrl(download.url, alternate.metadata.name || alternate.title || alternate.id).catch(error => console.warn('[Workflow] Alternate download failed.', error)); }}
        ><Download size={12} /><span className="workflow-alt-stack__label">{en ? 'Download' : '下载'}</span></button>
        {!locked && (
          <button type="button" data-action="promote" title={en ? 'Make primary' : '设为首图'} aria-label={en ? `Make ${name} primary` : `把${name}设为首图`} onClick={onPromote}>
            <Star size={12} /><span className="workflow-alt-stack__label">{en ? 'Make primary' : '设为首图'}</span>
          </button>
        )}
      </div>
    </motion.div>
  );
}

export interface WorkflowAlternatesStackProps {
  node: WorkflowNode;
  language?: 'en' | 'zho';
  expanded: boolean;
  onToggleExpanded: () => void;
  /** 打开画廊：0 = 首图、1.. = 备选。 */
  onPreview: (index: number) => void;
  onPromote: (alternateId: string) => void;
}

export function WorkflowAlternatesStack({ node, language = 'zho', expanded, onToggleExpanded, onPreview, onPromote }: WorkflowAlternatesStackProps) {
  const en = language === 'en';
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const alternates = nodeAlternates(node);
  const total = alternates.length + 1;

  // 悬停散开跟随整个节点（卡片是节点的子元素，节点自己的悬停 = 这一摞的悬停）。
  useEffect(() => {
    const host = rootRef.current?.parentElement;
    if (!host) return;
    const enter = () => setHovered(true);
    const leave = () => setHovered(false);
    host.addEventListener('pointerenter', enter);
    host.addEventListener('pointerleave', leave);
    host.addEventListener('focusin', enter);
    host.addEventListener('focusout', leave);
    return () => {
      host.removeEventListener('pointerenter', enter);
      host.removeEventListener('pointerleave', leave);
      host.removeEventListener('focusin', enter);
      host.removeEventListener('focusout', leave);
    };
  }, []);

  if (!usesAlternateStack(node)) return null;
  const allVideo = node.type === 'video' && alternates.every(item => item.type === 'video');
  const unit = allVideo ? (en ? '' : '个') : (en ? '' : '张');
  const expandLabel = en ? `Expand ${total} results` : `展开 ${total} 个结果`;
  const collapseLabel = en ? 'Collapse results' : '收起结果';

  return (
    <div
      ref={rootRef}
      className="workflow-alt-stack"
      data-testid="workflow-alternates"
      data-variant="stack"
      data-expanded={expanded ? 'true' : undefined}
    >
      {/* 后层卡片：在节点自己的叠放上下文里排到节点内容之下（z-index: -1），只露出斜出的边角。 */}
      <motion.div
        className="workflow-alt-stack__fan"
        aria-hidden="true"
        initial={false}
        animate={expanded ? 'gone' : hovered && !reduceMotion ? 'hover' : 'rest'}
        variants={{ rest: { opacity: 1 }, hover: { opacity: 1 }, gone: { opacity: 0, transition: { duration: 0.12 } } }}
      >
        {alternates.slice(0, 2).map((alternate, slot) => <StackLayer key={alternate.id} alternate={alternate} slot={slot} />)}
      </motion.div>
      <button
        type="button"
        className={'workflow-batch-stack__expand workflow-alt-stack__toggle' + (expanded ? ' is-active' : '')}
        data-workflow-overlay
        aria-expanded={expanded}
        title={expanded ? collapseLabel : (en ? 'Expand all results' : '展开全部结果')}
        aria-label={expanded ? collapseLabel : expandLabel}
        onPointerDown={stop}
        onDoubleClick={stop}
        onClick={event => { event.stopPropagation(); onToggleExpanded(); }}
      >
        {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        <span>{expanded ? (en ? 'Collapse' : '收起') : `${total}${unit}`}</span>
      </button>
      {expanded && <span className="workflow-batch-cell__badge workflow-alt-stack__primary"><Check size={11} />{en ? 'Primary' : '首图'}</span>}
      <AnimatePresence>
        {expanded && alternates.map((alternate, index) => (
          <StackCell
            key={alternate.id}
            alternate={alternate}
            index={index + 1}
            count={total}
            width={node.width}
            height={node.height}
            en={en}
            locked={Boolean(node.isLocked)}
            reduceMotion={Boolean(reduceMotion)}
            onPreview={() => onPreview(index + 1)}
            onPromote={() => onPromote(alternate.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
