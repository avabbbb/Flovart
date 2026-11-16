import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type SyntheticEvent } from 'react';
import { ChevronDown, Download, Eye, Split, Star, Trash2 } from 'lucide-react';
import { AlternateThumb } from './alternateMedia';
import { nodeAlternates, usesAlternateStack } from './batchAlternates';
import { workflowAlternatesStackExtent } from './WorkflowAlternatesStack';
import type { WorkflowMediaAlternate, WorkflowNode } from './types';

/**
 * 多结果的备选网格（DESIGN 01 §13.3）：结果总数 > ALTERNATE_STACK_MAX_TOTAL（4）时挂在首图节点下方，
 * 宽度跟节点一致，随节点移动；带多选，内部滚动，不铺到画布上。总数 ≤4 走斜叠卡片（WorkflowAlternatesStack）。
 * 不是玻璃 chrome（节点附属内容，DESIGN §9.1 第 1 层），只用实底 + 发丝线。
 */

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

/**
 * 备选在节点盒子之外占的范围（世界坐标，相对节点右缘 / 下缘），画布据此把 PromptBar 放到它下面。
 * 网格：只向下长；叠放：收起时只有斜出的边角，展开时 2 列网格向右、向下长。
 */
export function workflowAlternatesExtent(
  node: Pick<WorkflowNode, 'width' | 'height' | 'metadata'>,
  state: { gridCollapsed?: boolean; stackExpanded?: boolean } = {},
) {
  const count = nodeAlternates(node).length;
  if (!count) return { right: 0, bottom: 0 };
  if (usesAlternateStack(node)) return workflowAlternatesStackExtent(node, Boolean(state.stackExpanded));
  return { right: 0, bottom: DOCK_GAP + GRID_HEADER + (state.gridCollapsed ? 0 : gridGeometry(node.width, count).body) + 2 };
}

const stop = (event: SyntheticEvent) => event.stopPropagation();

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
  const alternates = nodeAlternates(node);
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
  if (!alternates.length || usesAlternateStack(node)) return null;

  const swallow = { onPointerDown: (event: ReactPointerEvent) => event.stopPropagation(), onDoubleClick: stop };
  const label = (index: number, alternate: WorkflowMediaAlternate) => {
    const kind = alternate.type === 'video' ? (en ? 'video' : '视频') : (en ? 'image' : '图片');
    return en ? `Alternate ${index + 1} (${kind})` : `备选 ${index + 1}（${kind}）`;
  };
  const promoteTitle = en ? 'Make primary' : '设为首图';

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
