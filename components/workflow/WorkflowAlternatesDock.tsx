import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type SyntheticEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ChevronDown, Download, Eye, Images, Play, Split, Star, Trash2 } from 'lucide-react';
import { useWorkflowMediaUrl } from './media';
import { ALTERNATE_STRIP_MAX, nodeAlternates } from './batchAlternates';
import type { WorkflowMediaAlternate, WorkflowNode } from './types';

/**
 * 多结果的备选（DESIGN 01 §13.3）：挂在首图节点下方，宽度跟节点一致，随节点移动。
 * ≤4 个：一行紧凑缩略图；更多：带多选的网格，内部滚动，不铺到画布上。
 * 不是玻璃 chrome（节点附属内容，DESIGN §9.1 第 1 层），只用实底 + 发丝线。
 */

const SNAPPY = { type: 'spring', visualDuration: 0.22, bounce: 0 } as const;
const STRIP_THUMB = 46;
const DOCK_GAP = 10;
const GRID_HEADER = 32;
const GRID_GAP = 6;
const GRID_PAD = 6;
const GRID_MIN_CELL = 64;

function gridGeometry(width: number, count: number) {
  const inner = Math.max(120, width - GRID_PAD * 2 - 2);
  const columns = Math.max(3, Math.min(8, Math.floor((inner + GRID_GAP) / (GRID_MIN_CELL + GRID_GAP))));
  const cell = (inner - (columns - 1) * GRID_GAP) / columns;
  const rows = Math.ceil(count / columns);
  // 最多露出 2 行半：第三行露半截，提示可以滚动。
  const visibleRows = rows <= 2 ? rows : 2.5;
  const body = visibleRows * cell + Math.max(0, Math.ceil(visibleRows) - 1) * GRID_GAP + GRID_PAD * 2;
  return { columns, cell, body: Math.round(body) };
}

/** 备选区在节点下方占的高度（世界坐标，含与节点的间距），画布据此把 PromptBar 放到它下面。 */
export function workflowAlternatesDockHeight(node: Pick<WorkflowNode, 'width' | 'metadata'>, collapsed = false) {
  const count = nodeAlternates(node).length;
  if (!count) return 0;
  if (count <= ALTERNATE_STRIP_MAX) return DOCK_GAP + STRIP_THUMB + 2;
  return DOCK_GAP + GRID_HEADER + (collapsed ? 0 : gridGeometry(node.width, count).body) + 2;
}

const stop = (event: SyntheticEvent) => event.stopPropagation();

function formatDuration(ms?: number) {
  if (!ms || !Number.isFinite(ms)) return '';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function AlternateThumb({ alternate }: { alternate: WorkflowMediaAlternate }) {
  const video = alternate.type === 'video';
  const source = useWorkflowMediaUrl(
    video ? alternate.metadata.posterStorageKey : alternate.metadata.storageKey,
    video ? alternate.metadata.poster : alternate.metadata.href,
    video ? undefined : alternate.metadata.artifactRef,
  );
  return (
    <>
      {source.url
        ? <img className="workflow-alternates__media" src={source.url} alt="" draggable={false} loading="lazy" />
        : <span className="workflow-alternates__media workflow-alternates__media--empty" aria-hidden="true">{video ? <Play size={14} /> : <Images size={14} />}</span>}
      {video && <span className="workflow-alternates__video-mark" aria-hidden="true"><Play size={9} fill="currentColor" />{formatDuration(alternate.metadata.durationMs)}</span>}
    </>
  );
}

export interface WorkflowAlternatesDockProps {
  node: WorkflowNode;
  language?: 'en' | 'zho';
  /** 打开画廊预览：index 是 0 = 首图、1.. = 备选；ids 给出时只预览这些备选。 */
  onPreview: (index: number, ids?: string[]) => void;
  onPromote: (alternateId: string) => void;
  onRemove: (ids: string[]) => void;
  onSplit: (ids: string[]) => void;
  onExport: (ids: string[]) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function WorkflowAlternatesDock({ node, language = 'zho', onPreview, onPromote, onRemove, onSplit, onExport, collapsed = false, onToggleCollapsed }: WorkflowAlternatesDockProps) {
  const en = language === 'en';
  const reduceMotion = useReducedMotion();
  const alternates = nodeAlternates(node);
  const total = alternates.length + 1;
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const idsKey = alternates.map(item => item.id).join('|');
  // 备选变化（删除、拆出、设为首图换槽）后，去掉已经不存在的勾选。
  useEffect(() => {
    setSelected(current => {
      const alive = new Set(alternates.map(item => item.id));
      const next = new Set([...current].filter(id => alive.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const geometry = useMemo(() => gridGeometry(node.width, alternates.length), [node.width, alternates.length]);
  if (!alternates.length) return null;

  const swallow = { onPointerDown: (event: ReactPointerEvent) => event.stopPropagation(), onDoubleClick: stop };
  const label = (index: number, alternate: WorkflowMediaAlternate) => {
    const kind = alternate.type === 'video' ? (en ? 'video' : '视频') : (en ? 'image' : '图片');
    return en ? `Alternate ${index + 1} (${kind})` : `备选 ${index + 1}（${kind}）`;
  };
  const promoteTitle = en ? 'Make primary' : '设为首图';

  if (alternates.length <= ALTERNATE_STRIP_MAX) {
    return (
      <div className="workflow-alternates" data-variant="strip" data-testid="workflow-alternates" style={{ top: `calc(100% + ${DOCK_GAP}px)` }} onDoubleClick={stop}>
        <AnimatePresence initial={false}>
          {alternates.map((alternate, index) => (
            <motion.div
              key={alternate.id}
              layout={!reduceMotion}
              className="workflow-alternates__cell"
              data-alternate-id={alternate.id}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
              transition={SNAPPY}
              style={{ width: STRIP_THUMB, height: STRIP_THUMB }}
            >
              <button type="button" className="workflow-alternates__thumb" aria-label={(en ? 'Preview ' : '预览') + label(index, alternate)} title={alternate.title || label(index, alternate)} {...swallow} onClick={event => { event.stopPropagation(); onPreview(index + 1); }}>
                <AlternateThumb alternate={alternate} />
              </button>
              <button type="button" className="workflow-alternates__promote" aria-label={`${promoteTitle}：${label(index, alternate)}`} title={promoteTitle} {...swallow} onClick={event => { event.stopPropagation(); onPromote(alternate.id); }}><Star size={11} /></button>
            </motion.div>
          ))}
        </AnimatePresence>
        <button type="button" className="workflow-alternates__count" title={en ? `Preview all ${total} results` : `预览全部 ${total} 个结果`} aria-label={en ? `Preview all ${total} results` : `预览全部 ${total} 个结果`} {...swallow} onClick={event => { event.stopPropagation(); onPreview(0); }}>
          <Images size={12} /><span>{total}</span>
        </button>
      </div>
    );
  }

  const selectedIds = alternates.filter(item => selected.has(item.id)).map(item => item.id);
  const allSelected = selectedIds.length === alternates.length;
  const someSelected = selectedIds.length > 0;
  const toggle = (id: string) => setSelected(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const actions: Array<{ key: string; label: string; icon: ReactNode; run: () => void; danger?: boolean }> = someSelected
    ? [
      { key: 'preview', label: en ? 'Compare' : '对比预览', icon: <Eye size={13} />, run: () => onPreview(0, selectedIds) },
      { key: 'export', label: en ? 'Export' : '导出', icon: <Download size={13} />, run: () => onExport(selectedIds) },
      { key: 'split', label: en ? 'Split out' : '拆成独立节点', icon: <Split size={13} />, run: () => { onSplit(selectedIds); setSelected(new Set()); } },
      { key: 'delete', label: en ? 'Delete' : '删除', icon: <Trash2 size={13} />, run: () => { onRemove(selectedIds); setSelected(new Set()); }, danger: true },
    ]
    : [{ key: 'preview-all', label: en ? 'Preview all' : '预览全部', icon: <Eye size={13} />, run: () => onPreview(0) }];

  return (
    <div
      className="workflow-alternates"
      data-variant="grid"
      data-testid="workflow-alternates"
      data-collapsed={collapsed ? 'true' : undefined}
      style={{ top: `calc(100% + ${DOCK_GAP}px)` }}
      onDoubleClick={stop}
    >
      <div className="workflow-alternates__header">
        <label className="workflow-alternates__check workflow-alternates__check--all" title={allSelected ? (en ? 'Clear selection' : '取消全选') : (en ? 'Select all' : '全选')} {...swallow}>
          <input
            type="checkbox"
            checked={allSelected}
            ref={input => { if (input) input.indeterminate = someSelected && !allSelected; }}
            aria-label={allSelected ? (en ? 'Clear selection' : '取消全选') : (en ? 'Select all alternates' : '全选备选')}
            onChange={() => setSelected(allSelected ? new Set() : new Set(alternates.map(item => item.id)))}
          />
        </label>
        <span className="workflow-alternates__title">
          <span className="workflow-alternates__title-text">{someSelected ? (en ? `${selectedIds.length} selected` : `已选 ${selectedIds.length}`) : (en ? 'Alternates' : '备选')}</span>
          {!someSelected && <span className="workflow-alternates__badge" aria-label={en ? `${alternates.length} alternates` : `${alternates.length} 个备选`}>{alternates.length}</span>}
        </span>
        <div className="workflow-alternates__actions">
          {actions.map(action => (
            <button key={action.key} type="button" data-action={action.key} className={'workflow-alternates__action' + (action.danger ? ' is-danger' : '')} title={action.label} aria-label={action.label} {...swallow} onClick={event => { event.stopPropagation(); action.run(); }}>
              {action.icon}<span className="workflow-alternates__action-label">{action.label}</span>
            </button>
          ))}
          {onToggleCollapsed && (
            <button type="button" className="workflow-alternates__action workflow-alternates__collapse" aria-expanded={!collapsed} title={collapsed ? (en ? 'Show alternates' : '展开备选') : (en ? 'Hide alternates' : '收起备选')} aria-label={collapsed ? (en ? 'Show alternates' : '展开备选') : (en ? 'Hide alternates' : '收起备选')} {...swallow} onClick={event => { event.stopPropagation(); onToggleCollapsed(); }}>
              <ChevronDown size={13} />
            </button>
          )}
        </div>
      </div>
      {!collapsed && (
        <div
          className="workflow-alternates__grid isl-scrollbar"
          data-workflow-overlay
          role="list"
          aria-label={en ? 'Alternates' : '备选'}
          style={{ height: geometry.body, gridTemplateColumns: `repeat(${geometry.columns}, minmax(0, 1fr))`, gridAutoRows: geometry.cell }}
          onPointerDown={event => event.stopPropagation()}
        >
          {alternates.map((alternate, index) => {
            const isSelected = selected.has(alternate.id);
            return (
              <div key={alternate.id} role="listitem" className={'workflow-alternates__cell' + (isSelected ? ' is-selected' : '')} data-alternate-id={alternate.id}>
                <button
                  type="button"
                  className="workflow-alternates__thumb"
                  aria-label={(someSelected ? (isSelected ? (en ? 'Deselect ' : '取消选择') : (en ? 'Select ' : '选择')) : (en ? 'Preview ' : '预览')) + label(index, alternate)}
                  title={alternate.title || label(index, alternate)}
                  {...swallow}
                  onClick={event => {
                    event.stopPropagation();
                    if (someSelected || event.shiftKey || event.metaKey || event.ctrlKey) toggle(alternate.id);
                    else onPreview(index + 1);
                  }}
                >
                  <AlternateThumb alternate={alternate} />
                  <span className="workflow-alternates__index" aria-hidden="true">{index + 2}</span>
                </button>
                <label className="workflow-alternates__check" {...swallow}>
                  <input type="checkbox" checked={isSelected} aria-label={(en ? 'Select ' : '选择') + label(index, alternate)} onChange={() => toggle(alternate.id)} />
                </label>
                <button type="button" className="workflow-alternates__promote" aria-label={`${promoteTitle}：${label(index, alternate)}`} title={promoteTitle} {...swallow} onClick={event => { event.stopPropagation(); onPromote(alternate.id); }}><Star size={11} /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
