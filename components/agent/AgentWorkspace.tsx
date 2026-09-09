import { Bot, Boxes, CircleDot, Grid2X2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import '../../styles/agent.css';
import { useWorkflowMediaUrl } from '../workflow/media';
import type { WorkflowNode, WorkflowProject } from '../workflow/types';
import { ProductionCrewPanel } from './ProductionCrewPanel';
import { AgentHostPicker } from './AgentHostPicker';
import { useAgentWorkspaceStore, type AgentPanelStatus } from './agentWorkspaceStore';

interface AgentWorkspaceProps {
  project: WorkflowProject | null;
  onCreateProject: () => void;
  onOpenWorkflow: () => void;
  onOpenTable: (nodeId?: string) => void;
}

const STATUS_LABEL: Record<AgentPanelStatus, string> = { idle: '待命', running: '运行中', waiting: '待确认', done: '已完成', error: '异常' };

export function AgentWorkspace({ project, onCreateProject, onOpenWorkflow, onOpenTable }: AgentWorkspaceProps) {
  const ensureLayout = useAgentWorkspaceStore(state => state.ensureLayout);
  const layouts = useAgentWorkspaceStore(state => state.layouts);
  const [activeContext, setActiveContext] = useState<'brief' | 'activity' | 'artifacts' | 'crew'>('artifacts');
  const layout = project ? layouts[project.id] : undefined;
  const mediaNodes = useMemo(() => project?.nodes.filter(node => node.type === 'image' || node.type === 'video') || [], [project]);
  useEffect(() => { if (project) ensureLayout(project.id); }, [ensureLayout, project]);

  if (!project) return <main className="agent-workspace-shell agent-workspace-shell--empty" data-testid="agent-main-workspace" style={{ color: 'var(--isl-ink)' }}><div className="mx-auto w-full max-w-3xl"><AgentHostPicker /><div className="mt-6 rounded-xl border p-6 text-center" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface)' }}><Bot className="mx-auto mb-3" size={26} style={{ color: 'var(--isl-mint)' }} /><strong>从一个新项目开始</strong><p className="mt-1 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>创建画布后，你和助手可以一起编辑，结果会保存在这里。</p><button type="button" className="mx-auto mt-3 rounded-lg border px-3 py-2 text-xs font-semibold" style={{ borderColor: 'var(--isl-border)' }} onClick={onCreateProject}>创建项目</button></div></div></main>;

  const status = layout?.panels.find(panel => panel.kind === 'crew')?.status || 'idle';

  return (
    <main className="agent-workspace-shell" data-testid="agent-main-workspace" data-mobile-context={activeContext}>
      <aside className="agent-workspace-shell__context">
        <header className="agent-workspace-header">
          <div><span>协作空间</span><strong>{project.title}</strong></div>
        </header>
        <AgentHostPicker projectTitle={project.title} />
        <nav className="agent-workspace-tabs" aria-label="Agent 上下文">
          <button type="button" aria-pressed={activeContext === 'brief'} onClick={() => setActiveContext('brief')}><Sparkles size={14} />Brief</button>
          <button type="button" aria-pressed={activeContext === 'artifacts'} onClick={() => setActiveContext('artifacts')}><Boxes size={14} />产物</button>
          <button type="button" aria-pressed={activeContext === 'activity'} onClick={() => setActiveContext('activity')}><CircleDot size={14} />时间线</button>
          <button type="button" aria-pressed={activeContext === 'crew'} onClick={() => setActiveContext('crew')} className="agent-workspace-tabs__crew"><Bot size={14} />现场</button>
        </nav>
        <section className="agent-workspace-body">
          {activeContext === 'brief' && <BriefPanel project={project} onOpenWorkflow={onOpenWorkflow} />}
          {activeContext === 'activity' && <ActivityPanel project={project} />}
          {activeContext === 'artifacts' && <ArtifactsPanel nodes={mediaNodes} onOpenTable={onOpenTable} />}
          {activeContext === 'crew' && <div className="agent-context-empty"><Bot size={24} /><span>制作现场已切换到当前页面。</span></div>}
        </section>
        <footer className="agent-workspace-footer">
          <span className={`agent-status is-${status}`}><i />{STATUS_LABEL[status]}</span>
          <button type="button" onClick={onOpenWorkflow}><Grid2X2 size={13} />打开 Workflow</button>
        </footer>
      </aside>
      <section className="agent-workspace-shell__conversation">
        <button type="button" className="agent-workspace-shell__mobile-back" onClick={() => setActiveContext('artifacts')}>← 返回上下文</button>
        <ProductionCrewPanel project={project} />
      </section>
    </main>
  );
}

function BriefPanel({ project }: { project: WorkflowProject; onOpenWorkflow: () => void }) {
  const running = project.nodes.filter(node => node.metadata.status === 'loading').length;
  return <div className="agent-brief"><p>制作上下文</p><h2>{project.title}</h2><span>协作 Agent 与 Flovart 使用同一份 Workflow；可逆操作会直接保存，付费执行和删除仍由你确认。</span><div>{[[project.nodes.length, '节点'], [project.connections.length, '连接'], [running, '运行中']].map(([value, label]) => <section key={label}><strong>{value}</strong><small>{label}</small></section>)}</div></div>;
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
