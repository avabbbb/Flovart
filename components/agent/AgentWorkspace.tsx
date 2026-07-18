import { motion } from 'motion/react';
import { Bot, Boxes, CircleDot, Focus, Grid2X2, Maximize2, Minus, Plus, RotateCcw, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowOnlineTurnInput } from '../workflow/WorkflowAgentPanel';
import { WorkflowAgentPanel, type WorkflowAgentActivity } from '../workflow/WorkflowAgentPanel';
import { useWorkflowMediaUrl } from '../workflow/media';
import type { WorkflowNode, WorkflowProject } from '../workflow/types';
import { useAgentWorkspaceStore, type AgentPanelStatus, type AgentWorkspacePanel } from './agentWorkspaceStore';

interface AgentWorkspaceProps {
  project: WorkflowProject | null;
  onCreateProject: () => void;
  onProjectChange: (projectId: string, patch: Partial<Omit<WorkflowProject, 'id' | 'createdAt'>>) => void;
  onOnlineTurn?: (input: WorkflowOnlineTurnInput) => Promise<void>;
  onOpenWorkflow: () => void;
  onOpenTable: (nodeId?: string) => void;
}

const STATUS_LABEL: Record<AgentPanelStatus, string> = { idle: '待命', running: '运行中', waiting: '待确认', done: '已完成', error: '异常' };

export function AgentWorkspace({ project, onCreateProject, onProjectChange, onOnlineTurn, onOpenWorkflow, onOpenTable }: AgentWorkspaceProps) {
  const ensureLayout = useAgentWorkspaceStore(state => state.ensureLayout);
  const updatePanel = useAgentWorkspaceStore(state => state.updatePanel);
  const setStoredViewport = useAgentWorkspaceStore(state => state.setViewport);
  const addCodexPanel = useAgentWorkspaceStore(state => state.addCodexPanel);
  const resetLayout = useAgentWorkspaceStore(state => state.resetLayout);
  const removePanel = useAgentWorkspaceStore(state => state.removePanel);
  const layout = useAgentWorkspaceStore(state => project ? state.layouts[project.id] : undefined);
  const [viewport, setViewport] = useState({ x: 42, y: 38, zoom: 1 });
  const [panning, setPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0, viewportX: 0, viewportY: 0 });

  useEffect(() => { if (project) ensureLayout(project.id); }, [ensureLayout, project]);
  useEffect(() => { if (layout) setViewport(layout.viewport); }, [layout?.viewport.x, layout?.viewport.y, layout?.viewport.zoom, project?.id]);

  const mediaNodes = useMemo(() => project?.nodes.filter(node => node.type === 'image' || node.type === 'video') || [], [project]);
  const maxZ = Math.max(0, ...(layout?.panels.map(panel => panel.z) || []));

  if (!project) return <div className="grid h-full place-content-center text-center" style={{ color: 'var(--isl-ink)' }}><Bot className="mx-auto mb-3" size={30} style={{ color: 'var(--isl-mint)' }} /><strong>Agent 需要一个制作项目</strong><p className="mt-1 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>创建 Workflow 后，任务、上下文与产物会在这里汇合。</p><button type="button" className="mx-auto mt-3 rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ background: 'var(--isl-mint)' }} onClick={onCreateProject}>创建项目</button></div>;
  if (!layout) return null;

  const commitViewport = (next = viewport) => setStoredViewport(project.id, next);
  const zoomBy = (delta: number) => {
    const next = { ...viewport, zoom: Math.min(1.6, Math.max(.45, Number((viewport.zoom + delta).toFixed(2)))) };
    setViewport(next);
    commitViewport(next);
  };

  return (
    <div
      className={`agent-workspace relative h-full overflow-hidden border-t ${panning ? 'cursor-grabbing' : ''}`}
      style={{ borderColor: 'var(--isl-border)', color: 'var(--isl-ink)', backgroundColor: 'var(--isl-surface-sunk)', backgroundImage: 'radial-gradient(var(--isl-border-strong) 1px, transparent 1px)', backgroundSize: `${22 * viewport.zoom}px ${22 * viewport.zoom}px`, backgroundPosition: `${viewport.x}px ${viewport.y}px` }}
      onPointerDown={event => {
        if (event.target !== event.currentTarget || event.button !== 0) return;
        setPanning(true);
        panStart.current = { x: event.clientX, y: event.clientY, viewportX: viewport.x, viewportY: viewport.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => { if (panning) setViewport(current => ({ ...current, x: panStart.current.viewportX + event.clientX - panStart.current.x, y: panStart.current.viewportY + event.clientY - panStart.current.y })); }}
      onPointerUp={event => { if (!panning) return; setPanning(false); event.currentTarget.releasePointerCapture(event.pointerId); setViewport(current => { commitViewport(current); return current; }); }}
      onWheel={event => { if (!event.ctrlKey) return; event.preventDefault(); zoomBy(event.deltaY > 0 ? -.08 : .08); }}
    >
      <div className="pointer-events-none absolute left-4 top-3 z-50 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]" style={{ borderColor: 'var(--isl-border)', background: 'color-mix(in srgb,var(--isl-card) 90%,transparent)' }}><Bot size={13} style={{ color: 'var(--isl-mint-deep)' }} /><strong>{project.title}</strong><span style={{ color: 'var(--isl-ink-ghost)' }}>{layout.panels.length} 个任务面板</span></div>
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: 1500, height: 900, transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
        {layout.panels.map(panel => (
          <AgentPanel
            key={panel.id}
            panel={panel}
            project={project}
            mediaNodes={mediaNodes}
            maxZ={maxZ}
            onMove={(x, y) => updatePanel(project.id, panel.id, { x, y })}
            onResize={(width, height) => updatePanel(project.id, panel.id, { width, height })}
            onFocus={() => updatePanel(project.id, panel.id, { z: maxZ + 1 })}
            onRemove={panel.kind === 'codex' && layout.panels.filter(item => item.kind === 'codex').length > 1 ? () => removePanel(project.id, panel.id) : undefined}
            onActivity={status => updatePanel(project.id, panel.id, { status })}
            onProjectChange={patch => onProjectChange(project.id, patch)}
            onOnlineTurn={onOnlineTurn}
            onOpenWorkflow={onOpenWorkflow}
            onOpenTable={onOpenTable}
          />
        ))}
      </div>
      <div className="absolute bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-xl border p-1" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-card)', boxShadow: 'var(--isl-shadow)' }}>
        <button type="button" className="isl-icon-btn h-8 w-8" title="缩小" onClick={() => zoomBy(-.1)}><Minus size={14} /></button>
        <span className="w-11 text-center text-[10px] font-bold tabular-nums">{Math.round(viewport.zoom * 100)}%</span>
        <button type="button" className="isl-icon-btn h-8 w-8" title="放大" onClick={() => zoomBy(.1)}><Plus size={14} /></button>
        <span className="mx-1 h-4 w-px" style={{ background: 'var(--isl-border)' }} />
        <button type="button" className="isl-icon-btn h-8 gap-1 px-2 text-[11px]" onClick={() => addCodexPanel(project.id)}><Bot size={13} />新线程</button>
        <button type="button" className="isl-icon-btn h-8 w-8" title="恢复默认布局" onClick={() => resetLayout(project.id)}><RotateCcw size={13} /></button>
        <button type="button" className="isl-icon-btn h-8 w-8" title="回到内容" onClick={() => { const next = { x: 42, y: 38, zoom: 1 }; setViewport(next); commitViewport(next); }}><Focus size={14} /></button>
      </div>
    </div>
  );
}

interface AgentPanelProps {
  panel: AgentWorkspacePanel;
  project: WorkflowProject;
  mediaNodes: WorkflowNode[];
  maxZ: number;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  onFocus: () => void;
  onRemove?: () => void;
  onActivity: (status: AgentPanelStatus) => void;
  onProjectChange: (patch: Pick<WorkflowProject, 'agentSessions' | 'activeAgentSessionId'>) => void;
  onOnlineTurn?: (input: WorkflowOnlineTurnInput) => Promise<void>;
  onOpenWorkflow: () => void;
  onOpenTable: (nodeId?: string) => void;
}

function AgentPanel({ panel, project, mediaNodes, onMove, onResize, onFocus, onRemove, onActivity, onProjectChange, onOnlineTurn, onOpenWorkflow, onOpenTable }: AgentPanelProps) {
  const drag = useRef<{ x: number; y: number; panelX: number; panelY: number } | undefined>(undefined);
  const resize = useRef<{ x: number; y: number; width: number; height: number } | undefined>(undefined);
  const Icon = panel.kind === 'codex' ? Bot : panel.kind === 'artifacts' ? Boxes : panel.kind === 'activity' ? CircleDot : Sparkles;
  return <motion.section className="absolute flex min-h-0 flex-col overflow-hidden rounded-xl border" style={{ left: panel.x, top: panel.y, width: panel.width, height: panel.height, zIndex: panel.z, borderColor: panel.status === 'waiting' ? 'var(--isl-sun)' : panel.status === 'error' ? 'var(--isl-coral)' : 'var(--isl-border-strong)', background: 'var(--isl-card)', boxShadow: 'var(--isl-shadow)' }} initial={{ opacity: 0, scale: .94, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 390, damping: 31 }} onPointerDown={onFocus}>
    <header className="flex h-9 shrink-0 cursor-grab items-center gap-2 border-b px-2.5 active:cursor-grabbing" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface)' }} onPointerDown={event => { if ((event.target as HTMLElement).closest('button')) return; drag.current = { x: event.clientX, y: event.clientY, panelX: panel.x, panelY: panel.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (drag.current) onMove(drag.current.panelX + event.clientX - drag.current.x, drag.current.panelY + event.clientY - drag.current.y); }} onPointerUp={event => { drag.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId); }}>
      <Icon size={13} /><strong className="min-w-0 flex-1 truncate text-[11px]">{panel.title}</strong><span className={`agent-status is-${panel.status}`}><i />{STATUS_LABEL[panel.status]}</span>{onRemove && <button type="button" className="isl-icon-btn h-6 w-6" aria-label="关闭面板" onClick={onRemove}><X size={12} /></button>}
    </header>
    <div className="min-h-0 flex-1 overflow-hidden">
      {panel.kind === 'codex' && <WorkflowAgentPanel project={project} onClose={() => undefined} onProjectChange={onProjectChange} onOnlineTurn={onOnlineTurn} embedded onActivityChange={(activity: WorkflowAgentActivity) => onActivity(activity)} />}
      {panel.kind === 'brief' && <BriefPanel project={project} onOpenWorkflow={onOpenWorkflow} />}
      {panel.kind === 'activity' && <ActivityPanel project={project} />}
      {panel.kind === 'artifacts' && <ArtifactsPanel nodes={mediaNodes} onOpenTable={onOpenTable} />}
    </div>
    <button type="button" aria-label="调整面板大小" className="absolute bottom-0 right-0 grid h-5 w-5 cursor-nwse-resize place-items-center bg-transparent opacity-35" onPointerDown={event => { event.stopPropagation(); resize.current = { x: event.clientX, y: event.clientY, width: panel.width, height: panel.height }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (resize.current) onResize(Math.max(280, resize.current.width + event.clientX - resize.current.x), Math.max(180, resize.current.height + event.clientY - resize.current.y)); }} onPointerUp={event => { resize.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId); }}><Maximize2 size={10} /></button>
  </motion.section>;
}

function BriefPanel({ project, onOpenWorkflow }: { project: WorkflowProject; onOpenWorkflow: () => void }) {
  const running = project.nodes.filter(node => node.metadata.status === 'loading').length;
  return <div className="flex h-full flex-col p-3"><p className="m-0 text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: 'var(--isl-ink-ghost)' }}>Production context</p><h2 className="mb-1 mt-2 text-base leading-tight">{project.title}</h2><p className="m-0 text-[11px] leading-5" style={{ color: 'var(--isl-ink-soft)' }}>Agent 读取同一份 Workflow 快照；修改前仍需确认，产物回到 Workflow 或 Table。</p><div className="mt-3 grid grid-cols-3 gap-1.5">{[[project.nodes.length, '节点'], [project.connections.length, '连接'], [running, '运行中']].map(([value, label]) => <div key={label} className="rounded-lg p-2 text-center" style={{ background: 'var(--isl-surface-2)' }}><strong className="block text-sm">{value}</strong><span className="text-[9px]" style={{ color: 'var(--isl-ink-ghost)' }}>{label}</span></div>)}</div><button type="button" className="mt-auto flex items-center justify-center gap-1 rounded-lg border py-1.5 text-[10px] font-semibold" style={{ borderColor: 'var(--isl-border)' }} onClick={onOpenWorkflow}><Grid2X2 size={11} />打开 Workflow</button></div>;
}

function ActivityPanel({ project }: { project: WorkflowProject }) {
  const items = [...project.nodes].sort((a, b) => String(b.metadata.generationStartedAt || '').localeCompare(String(a.metadata.generationStartedAt || ''))).slice(0, 8);
  return <div className="h-full overflow-y-auto p-2">{items.length ? items.map(node => <div key={node.id} className="mb-1.5 flex items-start gap-2 rounded-lg p-2" style={{ background: 'var(--isl-surface-2)' }}><span className={`agent-task-dot is-${node.metadata.status || 'idle'}`} /><span className="min-w-0"><strong className="block truncate text-[10px]">{node.title}</strong><span className="block truncate text-[9px]" style={{ color: 'var(--isl-ink-ghost)' }}>{node.metadata.generationMessage || node.metadata.status || 'idle'}</span></span></div>) : <div className="grid h-full place-content-center text-center text-[11px]" style={{ color: 'var(--isl-ink-ghost)' }}>任务运行后，状态会留在这里。<br />不必翻聊天记录。</div>}</div>;
}

function ArtifactsPanel({ nodes, onOpenTable }: { nodes: WorkflowNode[]; onOpenTable: (nodeId?: string) => void }) {
  return <div className="grid grid-cols-2 gap-2 overflow-y-auto p-2">{nodes.map(node => <ArtifactCard key={node.id} node={node} onClick={() => onOpenTable(node.id)} />)}{!nodes.length && <div className="col-span-2 grid h-40 place-content-center text-center text-[11px]" style={{ color: 'var(--isl-ink-ghost)' }}>生成结果会自动汇集在这里。</div>}</div>;
}

function ArtifactCard({ node, onClick }: { node: WorkflowNode; onClick: () => void }) {
  const media = useWorkflowMediaUrl(node.metadata.storageKey, node.metadata.href);
  return <button type="button" className="overflow-hidden rounded-lg border text-left transition hover:-translate-y-0.5" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface)' }} onClick={onClick}><div className="aspect-video bg-black/10">{media.url && (node.type === 'video' ? <video src={media.url} muted preload="metadata" className="h-full w-full object-cover" /> : <img src={media.url} alt="" className="h-full w-full object-cover" />)}</div><div className="truncate px-2 py-1.5 text-[9px] font-semibold">{node.metadata.name || node.title}</div></button>;
}
