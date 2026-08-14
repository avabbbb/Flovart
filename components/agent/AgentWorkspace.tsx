import { Bot, Boxes, CircleDot, Grid2X2, Plus, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { WorkflowOnlineTurnInput } from '../workflow/WorkflowAgentPanel';
import { WorkflowAgentPanel, type WorkflowAgentActivity } from '../workflow/WorkflowAgentPanel';
import { useWorkflowMediaUrl } from '../workflow/media';
import type { WorkflowNode, WorkflowProject } from '../workflow/types';
import { FlovartAgentPanel } from './FlovartAgentPanel';
import { useAgentWorkspaceStore, type AgentPanelStatus } from './agentWorkspaceStore';

interface AgentWorkspaceProps {
  project: WorkflowProject | null;
  onCreateProject: () => void;
  onProjectChange: (projectId: string, patch: Partial<Omit<WorkflowProject, 'id' | 'createdAt'>>) => void;
  onOnlineTurn?: (input: WorkflowOnlineTurnInput) => Promise<void>;
  onOpenWorkflow: () => void;
  onOpenTable: (nodeId?: string) => void;
  onOpenSettings: () => void;
}

const STATUS_LABEL: Record<AgentPanelStatus, string> = { idle: '待命', running: '运行中', waiting: '待确认', done: '已完成', error: '异常' };

export function AgentWorkspace({ project, onCreateProject, onProjectChange, onOnlineTurn, onOpenWorkflow, onOpenTable, onOpenSettings }: AgentWorkspaceProps) {
  const addCodexPanel = useAgentWorkspaceStore(state => state.addCodexPanel);
  const ensureLayout = useAgentWorkspaceStore(state => state.ensureLayout);
  const removePanel = useAgentWorkspaceStore(state => state.removePanel);
  const updatePanel = useAgentWorkspaceStore(state => state.updatePanel);
  const layouts = useAgentWorkspaceStore(state => state.layouts);
  const [activeContext, setActiveContext] = useState<'brief' | 'activity' | 'artifacts'>('artifacts');
  const [activeCodexId, setActiveCodexId] = useState<string>();
  const layout = project ? layouts[project.id] : undefined;
  const mediaNodes = useMemo(() => project?.nodes.filter(node => node.type === 'image' || node.type === 'video') || [], [project]);
  useEffect(() => { if (project) ensureLayout(project.id); }, [ensureLayout, project]);

  if (!project) return <main className="grid h-full place-content-center text-center" style={{ color: 'var(--isl-ink)' }}><Bot className="mx-auto mb-3" size={30} style={{ color: 'var(--isl-mint)' }} /><strong>Agent 需要一个制作项目</strong><p className="mt-1 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>创建 Workflow 后，任务、上下文与产物会在这里汇合。</p><button type="button" className="mx-auto mt-3 rounded-lg px-3 py-2 text-xs font-bold text-white" style={{ background: 'var(--isl-mint)' }} onClick={onCreateProject}>创建项目</button></main>;

  const codexPanels = layout?.panels.filter(panel => panel.kind === 'codex') || [];
  const activeCodex = codexPanels.find(panel => panel.id === activeCodexId);
  const status = layout?.panels.find(panel => panel.kind === 'flovart')?.status || 'idle';
  const openNewCodex = () => {
    addCodexPanel(project.id);
    const added = [...(useAgentWorkspaceStore.getState().layouts[project.id]?.panels || [])].reverse().find(panel => panel.kind === 'codex');
    if (added) setActiveCodexId(added.id);
  };

  return (
    <main className="agent-studio" data-testid="agent-main-workspace">
      <aside className="agent-studio__context">
        <header className="agent-context__header">
          <div><span>Agent 空间</span><strong>{project.title}</strong></div>
          <button type="button" aria-label="添加 Codex 子任务" onClick={openNewCodex}><Plus size={15} /></button>
        </header>
        <nav className="agent-context__tabs" aria-label="Agent 上下文">
          <button type="button" aria-pressed={activeContext === 'brief'} onClick={() => setActiveContext('brief')}><Sparkles size={14} />Brief</button>
          <button type="button" aria-pressed={activeContext === 'artifacts'} onClick={() => setActiveContext('artifacts')}><Boxes size={14} />产物</button>
          <button type="button" aria-pressed={activeContext === 'activity'} onClick={() => setActiveContext('activity')}><CircleDot size={14} />时间线</button>
        </nav>
        <section className="agent-context__body">
          {activeContext === 'brief' && <BriefPanel project={project} onOpenWorkflow={onOpenWorkflow} />}
          {activeContext === 'activity' && <ActivityPanel project={project} />}
          {activeContext === 'artifacts' && <ArtifactsPanel nodes={mediaNodes} onOpenTable={onOpenTable} />}
        </section>
        <footer className="agent-context__footer">
          <span className={`agent-status is-${status}`}><i />{STATUS_LABEL[status]}</span>
          <button type="button" onClick={onOpenWorkflow}><Grid2X2 size={13} />打开 Workflow</button>
        </footer>
      </aside>

      <section className="agent-studio__conversation" aria-label="Flovart Agent 主对话">
        {activeCodex ? (
          <>
            <header className="agent-codex__header"><Bot size={14} /><strong>{activeCodex.title}</strong><button type="button" aria-label="关闭 Codex 子任务" onClick={() => { removePanel(project.id, activeCodex.id); setActiveCodexId(undefined); }}><X size={14} /></button></header>
            <WorkflowAgentPanel project={project} onClose={() => setActiveCodexId(undefined)} onProjectChange={patch => onProjectChange(project.id, patch)} onOnlineTurn={onOnlineTurn} embedded onActivityChange={(activity: WorkflowAgentActivity) => updatePanel(project.id, activeCodex.id, { status: activity })} />
          </>
        ) : <FlovartAgentPanel project={project} onActivityChange={activity => updatePanel(project.id, 'flovart-main', { status: activity })} onOpenSettings={onOpenSettings} />}
      </section>

      {codexPanels.length > 0 && <nav className="agent-studio__threads" aria-label="Agent 任务面板">
        <button type="button" aria-pressed={!activeCodex} onClick={() => setActiveCodexId(undefined)}><Bot size={13} />Flovart Agent</button>
        {codexPanels.map(panel => <button key={panel.id} type="button" aria-pressed={activeCodex?.id === panel.id} onClick={() => setActiveCodexId(panel.id)}>{panel.title}</button>)}
        <button type="button" aria-label="新增 Codex 子任务" onClick={openNewCodex}><Plus size={13} /></button>
      </nav>}
    </main>
  );
}

function BriefPanel({ project }: { project: WorkflowProject; onOpenWorkflow: () => void }) {
  const running = project.nodes.filter(node => node.metadata.status === 'loading').length;
  return <div className="agent-brief"><p>PRODUCTION CONTEXT</p><h2>{project.title}</h2><span>Agent 与你编辑同一份 Workflow Draft；可逆操作直接进入画布时间线，付费执行和删除仍由你确认。</span><div>{[[project.nodes.length, '节点'], [project.connections.length, '连接'], [running, '运行中']].map(([value, label]) => <section key={label}><strong>{value}</strong><small>{label}</small></section>)}</div></div>;
}

function ActivityPanel({ project }: { project: WorkflowProject }) {
  const changes = [...(project.draftChangeSets || [])].reverse().slice(0, 10);
  if (changes.length) return <div className="agent-activity">{changes.map(change => <div key={change.id}><strong>{change.intent}</strong><small>{change.actor === 'agent' ? 'Agent' : '你'} · {{ completed: '已应用', partial: '部分应用', failed: '失败', undone: '已撤销' }[change.status]} · v{change.resultDraftVersion}</small></div>)}</div>;
  return <div className="agent-context-empty"><CircleDot size={24} /><span>任务运行后，状态会留在这里。<br />不必翻聊天记录。</span></div>;
}

function ArtifactsPanel({ nodes, onOpenTable }: { nodes: WorkflowNode[]; onOpenTable: (nodeId?: string) => void }) {
  return <div className="agent-artifacts">{nodes.map(node => <ArtifactCard key={node.id} node={node} onClick={() => onOpenTable(node.id)} />)}{!nodes.length && <div className="agent-context-empty"><Boxes size={25} /><span>生成结果会自动汇集在这里。<br />你可以随时送往 Table 继续处理。</span></div>}</div>;
}

function ArtifactCard({ node, onClick }: { node: WorkflowNode; onClick: () => void }) {
  const media = useWorkflowMediaUrl(node.metadata.storageKey, node.metadata.href);
  return <button type="button" className="agent-artifact-card" onClick={onClick}>{node.type === 'video' ? <video src={media.url || undefined} muted playsInline /> : <img src={media.url || undefined} alt="" />}<span><strong>{node.title}</strong><small>{node.metadata.status || 'ready'}</small></span></button>;
}
