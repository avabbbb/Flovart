import { Eye, EyeOff, Folder, GripVertical, Image, Layers, Lock, Music, PanelLeftClose, SlidersHorizontal, Type, Unlock, Video, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import type { WorkflowNode, WorkflowProject } from './types';
import { AssetLibraryBrowser } from '../studio/AssetLibraryBrowser';
import type { AssetItem, AssetLibrary } from '../../types';

export interface WorkflowSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outerGap: number;
  project: WorkflowProject | null;
  onProjectChange: (patch: Partial<WorkflowProject>) => void;
  // 资产 tab 数据
  language: 'en' | 'zho';
  assetLibrary: AssetLibrary;
  onInsertAsset?: (item: AssetItem) => void;
  onRenameAsset: (id: string, name: string) => void;
  onRemoveAsset: (id: string) => void;
  onUpdateAssetTags?: (id: string, tags: string[]) => void;
  onRemoveAssetFromFolder?: (itemId: string, folderId: string) => void;
  onBatchRemoveAssets?: (ids: string[]) => void;
  onBatchAddAssetsToFolder?: (ids: string[], folderId: string) => void;
  onBatchAddAssetTags?: (ids: string[], tags: string[]) => void;
  onReverseAsset?: (item: AssetItem) => void;
  onCreateFolder: (parentId: string | null, name: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onRemoveFolder: (id: string, deleteItems: boolean) => void;
  tabRequest?: { tab: SidebarTab; nonce: number };
}

type SidebarTab = 'layers' | 'assets';

const nodeIcon = (node: WorkflowNode) => {
  if (node.type === 'image') return <Image size={14} />;
  if (node.type === 'video') return <Video size={14} />;
  if (node.type === 'audio') return <Music size={14} />;
  if (node.type === 'config') return <SlidersHorizontal size={14} />;
  return <Type size={14} />;
};

export const WorkflowSidebar: React.FC<WorkflowSidebarProps> = ({
  open,
  onOpenChange,
  outerGap,
  project,
  onProjectChange,
  language,
  assetLibrary,
  onInsertAsset,
  onRenameAsset,
  onRemoveAsset,
  onUpdateAssetTags,
  onRemoveAssetFromFolder,
  onBatchRemoveAssets,
  onBatchAddAssetsToFolder,
  onBatchAddAssetTags,
  onReverseAsset,
  onCreateFolder,
  onRenameFolder,
  onRemoveFolder,
  tabRequest,
}) => {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [tab, setTab] = useState<SidebarTab>('layers');
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (tabRequest) setTab(tabRequest.tab);
  }, [tabRequest]);

  // 点外部收起
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current && !panelRef.current.contains(target) && triggerRef.current && !triggerRef.current.contains(target)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, onOpenChange]);

  const patchNode = (id: string, patch: Partial<WorkflowNode>) => {
    if (!project) return;
    onProjectChange({
      nodes: project.nodes.map(node => node.id === id ? { ...node, ...patch } : node),
      updatedAt: new Date().toISOString(),
    });
  };

  const reorder = (targetId: string) => {
    if (!project || !draggedId || draggedId === targetId) return;
    const nodes = [...project.nodes];
    const from = nodes.findIndex(node => node.id === draggedId);
    const target = nodes.findIndex(node => node.id === targetId);
    if (from < 0 || target < 0) return;
    const [node] = nodes.splice(from, 1);
    nodes.splice(nodes.findIndex(item => item.id === targetId) + 1, 0, node);
    onProjectChange({ nodes, updatedAt: new Date().toISOString() });
    setDraggedId(null);
  };

  return (
    <>
      {/* 左侧触发按钮：折叠态 */}
      <button
        ref={triggerRef}
        type="button"
        className="isl-icon-btn theme-aware absolute z-40 h-10 w-10"
        style={{ left: outerGap, top: outerGap, opacity: open ? 0 : 1, pointerEvents: open ? 'none' : 'auto' }}
        onClick={() => onOpenChange(true)}
        title="打开图层与资产"
        aria-label="打开图层与资产"
      >
        <PanelLeftClose size={18} className="rotate-180" />
      </button>

      {/* 弹出浮层 */}
      {open && (
        <aside
          ref={panelRef}
          className="workflow-sidebar theme-aware absolute z-40 flex min-h-0 flex-col overflow-hidden rounded-2xl border-[1.5px]"
          style={{
            top: outerGap,
            left: outerGap,
            bottom: outerGap,
            width: `clamp(200px, 19vw, 300px)`,
            background: 'var(--isl-card)',
            borderColor: 'var(--isl-border)',
            boxShadow: 'var(--isl-shadow-lg)',
          }}
        >
          <div className="flex h-11 shrink-0 items-center justify-between px-3">
            <strong className="text-xs" style={{ color: 'var(--isl-ink)' }}>
              {tab === 'layers' ? (language === 'zho' ? '图层' : 'Layers') : (language === 'zho' ? '资产' : 'Assets')}
            </strong>
            <button type="button" className="isl-icon-btn h-8 w-8" onClick={() => onOpenChange(false)} title={language === 'zho' ? '收起' : 'Close'} aria-label={language === 'zho' ? '收起' : 'Close'}>
              <X size={16} />
            </button>
          </div>

          {/* tab 切换 */}
          <div className="flex shrink-0 items-center gap-1 px-3 pt-1 pb-2">
            <button
              type="button"
              data-testid="sidebar-tab-layers"
              onClick={() => setTab('layers')}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold transition"
              style={{
                background: tab === 'layers' ? 'var(--isl-surface-2)' : 'transparent',
                color: tab === 'layers' ? 'var(--isl-ink)' : 'var(--isl-ink-soft)',
              }}
            >
              <Layers size={13} />
              <span>{language === 'zho' ? '图层' : 'Layers'}</span>
              <span className="text-[10px] tabular-nums opacity-70">{project?.nodes.length || 0}</span>
            </button>
            <button
              type="button"
              data-testid="sidebar-tab-assets"
              onClick={() => setTab('assets')}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-bold transition"
              style={{
                background: tab === 'assets' ? 'var(--isl-surface-2)' : 'transparent',
                color: tab === 'assets' ? 'var(--isl-ink)' : 'var(--isl-ink-soft)',
              }}
            >
              <Folder size={13} />
              <span>{language === 'zho' ? '资产' : 'Assets'}</span>
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            {tab === 'layers' ? (
              <div className="min-h-0 flex-1 overflow-auto px-2 pb-2 pt-1">
        {!project?.nodes.length && <p className="px-2 py-6 text-center text-xs" style={{ color: 'var(--isl-ink-soft)' }}>{language === 'zho' ? '双击工作流空白处或从顶部工具栏添加节点' : 'Double-click the Workflow surface or use the toolbar to add nodes'}</p>}
                {[...(project?.nodes || [])].reverse().map(node => {
                  const selected = Boolean(project?.selectedNodeIds.includes(node.id));
                  return (
                    <div
                      key={node.id}
                      draggable
                      onDragStart={event => { event.dataTransfer.setData('text/plain', node.id); event.dataTransfer.effectAllowed = 'move'; setDraggedId(node.id); }}
                      onDragOver={event => event.preventDefault()}
                      onDrop={() => reorder(node.id)}
                      onClick={() => project && onProjectChange({ selectedNodeIds: [node.id] })}
                      className={`workflow-layer-card group mb-0.5 flex h-9 items-center gap-1.5 rounded-lg pl-1 pr-1.5 text-xs transition-colors duration-150 ${selected ? 'workflow-layer-card--selected' : ''}`}
                      style={{ color: 'var(--isl-ink)' }}
                      title={node.title}
                    >
                      <span className="workflow-layer-card__handle shrink-0 cursor-grab" style={{ color: 'var(--isl-ink-soft)' }}>
                        <GripVertical size={13} />
                      </span>
                      <span className="shrink-0" style={{ color: 'var(--isl-ink-soft)' }}>{nodeIcon(node)}</span>
                      <span className="min-w-0 flex-1 truncate">{node.title}</span>
                      <button
                        type="button"
                        className="workflow-layer-card__action shrink-0 rounded p-0.5 transition-opacity"
                        onClick={event => { event.stopPropagation(); patchNode(node.id, { isVisible: node.isVisible === false }); }}
                        title={node.isVisible === false ? (language === 'zho' ? '显示' : 'Show') : (language === 'zho' ? '隐藏' : 'Hide')}
                      >
                        {node.isVisible === false ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      <button
                        type="button"
                        className="workflow-layer-card__action shrink-0 rounded p-0.5 transition-opacity"
                        onClick={event => { event.stopPropagation(); patchNode(node.id, { isLocked: !node.isLocked }); }}
                        title={node.isLocked ? (language === 'zho' ? '解锁' : 'Unlock') : (language === 'zho' ? '锁定' : 'Lock')}
                      >
                        {node.isLocked ? <Lock size={13} /> : <Unlock size={13} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="min-h-0 flex-1">
                <AssetLibraryBrowser
                  compact
                  library={assetLibrary}
                  language={language}
                  onInsert={onInsertAsset}
                  onRenameAsset={onRenameAsset}
                  onRemoveAsset={onRemoveAsset}
                  onUpdateAssetTags={onUpdateAssetTags}
                  onRemoveAssetFromFolder={onRemoveAssetFromFolder}
                  onBatchRemoveAssets={onBatchRemoveAssets}
                  onBatchAddAssetsToFolder={onBatchAddAssetsToFolder}
                  onBatchAddAssetTags={onBatchAddAssetTags}
                  onReversePrompt={onReverseAsset}
                  onCreateFolder={onCreateFolder}
                  onRenameFolder={onRenameFolder}
                  onRemoveFolder={onRemoveFolder}
                />
              </div>
            )}
          </div>
        </aside>
      )}
    </>
  );
};
