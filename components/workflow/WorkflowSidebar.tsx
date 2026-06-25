import { Eye, EyeOff, Image, Lock, Music, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, Type, Unlock, Video } from 'lucide-react';
import React, { useState } from 'react';
import type { WorkflowNode, WorkflowProject } from './types';
import { WorkflowProjectList } from './WorkflowProjectList';

export interface WorkflowSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outerGap: number;
  project: WorkflowProject | null;
  onProjectChange: (patch: Partial<WorkflowProject>) => void;
}

const nodeIcon = (node: WorkflowNode) => {
  if (node.type === 'image') return <Image size={14} />;
  if (node.type === 'video') return <Video size={14} />;
  if (node.type === 'audio') return <Music size={14} />;
  if (node.type === 'config') return <SlidersHorizontal size={14} />;
  return <Type size={14} />;
};

export const WorkflowSidebar: React.FC<WorkflowSidebarProps> = ({ open, onOpenChange, outerGap, project, onProjectChange }) => {
  const [draggedId, setDraggedId] = useState<string | null>(null);

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
      <button
        type="button"
        className="isl-icon-btn theme-aware absolute z-40 h-10 w-10"
        style={{ left: outerGap, top: outerGap, opacity: open ? 0 : 1, pointerEvents: open ? 'none' : 'auto' }}
        onClick={() => onOpenChange(true)}
        title="打开项目与图层"
      >
        <PanelLeftOpen size={18} />
      </button>

      <aside
        className="workflow-sidebar theme-aware absolute z-40 flex min-h-0 flex-col overflow-hidden rounded-2xl border-[1.5px] transition-[transform,opacity] duration-200"
        style={{
          top: outerGap,
          left: outerGap,
          bottom: outerGap,
          width: `min(17.5rem, calc(100% - ${outerGap * 2}px))`,
          background: 'var(--isl-card)',
          borderColor: 'var(--isl-border)',
          boxShadow: 'var(--isl-shadow-lg)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transform: open ? 'translateX(0)' : 'translateX(calc(-100% - 24px))',
        }}
      >
        <div className="flex h-11 shrink-0 items-center justify-between px-3">
          <strong className="text-xs" style={{ color: 'var(--isl-ink)' }}>项目与图层</strong>
          <button type="button" className="isl-icon-btn h-8 w-8" onClick={() => onOpenChange(false)} title="收起左侧面板">
            <PanelLeftClose size={16} />
          </button>
        </div>
        <div className="max-h-[42%] shrink-0 overflow-auto border-y" style={{ borderColor: 'var(--isl-border)' }}>
          <WorkflowProjectList />
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: 'var(--isl-ink-soft)' }}>Layers</span>
            <span className="text-[10px] tabular-nums" style={{ color: 'var(--isl-ink-soft)' }}>{project?.nodes.length || 0}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-2">
            {!project?.nodes.length && <p className="px-2 py-6 text-center text-xs" style={{ color: 'var(--isl-ink-soft)' }}>双击画布或从底部工具栏添加节点</p>}
            {[...(project?.nodes || [])].reverse().map(node => (
              <div
                key={node.id}
                draggable
                onDragStart={event => { event.dataTransfer.setData('text/plain', node.id); event.dataTransfer.effectAllowed = 'move'; setDraggedId(node.id); }}
                onDragOver={event => event.preventDefault()}
                onDrop={() => reorder(node.id)}
                className={`group mb-1 flex h-9 items-center gap-2 rounded-lg px-2 text-xs ${project?.selectedNodeIds.includes(node.id) ? 'isl-tab--active' : ''}`}
                style={{ color: 'var(--isl-ink)' }}
                onClick={() => project && onProjectChange({ selectedNodeIds: [node.id] })}
              >
                <span style={{ color: 'var(--isl-ink-soft)' }}>{nodeIcon(node)}</span>
                <input
                  value={node.title}
                  className="min-w-0 flex-1 bg-transparent outline-none"
                  onClick={event => event.stopPropagation()}
                  onChange={event => patchNode(node.id, { title: event.target.value })}
                />
                <button type="button" className="opacity-60 hover:opacity-100" onClick={event => { event.stopPropagation(); patchNode(node.id, { isVisible: node.isVisible === false }); }} title={node.isVisible === false ? '显示' : '隐藏'}>
                  {node.isVisible === false ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button type="button" className="opacity-60 hover:opacity-100" onClick={event => { event.stopPropagation(); patchNode(node.id, { isLocked: !node.isLocked }); }} title={node.isLocked ? '解锁' : '锁定'}>
                  {node.isLocked ? <Lock size={14} /> : <Unlock size={14} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
};
