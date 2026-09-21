import { Boxes, CircleDot, Grid2X2, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import '../../styles/agent.css';
import { useWorkflowMediaUrl } from '../workflow/media';
import type { WorkflowNode, WorkflowProject } from '../workflow/types';
import { AgentHostPicker } from './AgentHostPicker';

interface AgentHubPanelProps {
  project: WorkflowProject | null;
  onCreateProject: () => void;
  onOpenWorkflow: () => void;
  onOpenTable: (nodeId?: string) => void;
}

type AgentHubContext = 'brief' | 'activity' | 'artifacts';

/**
 * Agent = verb, not a peer mode: this is the external-agent host hub folded
 * into the global right drawer. It keeps the old Agent workspace's reachable
 * surface (host picker + Brief/Artifacts/Timeline) beside the canvas instead
 * of replacing it.
 */
export function AgentHubPanel({ project, onCreateProject, onOpenWorkflow, onOpenTable }: AgentHubPanelProps) {
  const [activeContext, setActiveContext] = useState<AgentHubContext>('artifacts');
  const mediaNodes = useMemo(() => project?.nodes.filter(node => node.type === 'image' || node.type === 'video') || [], [project]);

  if (!project) return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="agent-drawer-hub" style={{ color: 'var(--isl-ink)' }}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AgentHostPicker />
        <CreateProjectCard onCreateProject={onCreateProject} />
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="agent-drawer-hub" style={{ color: 'var(--isl-ink)' }}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AgentHostPicker projectTitle={project.title} />
        <nav className="agent-workspace-tabs" aria-label="Agent 上下文">
          <button type="button" aria-pressed={activeContext === 'brief'} onClick={() => setActiveContext('brief')}><Sparkles size={14} />Brief</button>
          <button type="button" aria-pressed={activeContext === 'artifacts'} onClick={() => setActiveContext('artifacts')}><Boxes size={14} />产物</button>
          <button type="button" aria-pressed={activeContext === 'activity'} onClick={() => setActiveContext('activity')}><CircleDot size={14} />时间线</button>
        </nav>
        <section className="min-h-0">
          {activeContext === 'brief' && <BriefPanel project={project} />}
          {activeContext === 'activity' && <ActivityPanel project={project} />}
          {activeContext === 'artifacts' && <ArtifactsPanel nodes={mediaNodes} onOpenTable={onOpenTable} />}
        </section>
      </div>
      <footer className="agent-workspace-footer">
        <span className="agent-status is-idle"><i />连接与诊断</span>
        <button type="button" onClick={onOpenWorkflow}><Grid2X2 size={13} />打开 Workflow</button>
      </footer>
    </div>
  );
}
/**
 * Slim external-host switcher for the top of the Agent panel. The full picker
 * collapses into a details row so host selection is reachable without owning a
 * peer "协作" tab or a page.
 */
export function AgentHostHeader({ project }: { project: WorkflowProject }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="agent-host-header">
      <button type="button" className="agent-host-header__toggle" onClick={() => setExpanded(e => !e)} aria-expanded={expanded}>
        <CircleDot size={12} />
        <span>{expanded ? '外部 Host' : '切换外部 Host'}</span>
      </button>
      {expanded && <AgentHostPicker projectTitle={project.title} />}
    </div>
  );
}

/**
 * Project-less onboarding for the global Agent drawer. The built-in assistant
 * cannot chat before a Workflow exists, so the drawer's Agent tab falls back
 * to this: pick an external host or create the first project in place.
 */
export function AgentDrawerEmptyState({ onCreateProject }: { onCreateProject: () => void }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="agent-drawer-empty" style={{ color: 'var(--isl-ink)' }}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AgentHostPicker />
        <CreateProjectCard onCreateProject={onCreateProject} />
      </div>
    </div>
  );
}

function CreateProjectCard({ onCreateProject }: { onCreateProject: () => void }) {
  return (
    <div className="m-3 rounded-xl border p-5 text-center" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface)' }}>
      <Sparkles className="mx-auto mb-2" size={22} style={{ color: 'var(--isl-mint)' }} />
      <strong className="text-sm">从一个新项目开始</strong>
      <p className="mt-1 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>创建画布后，你和助手可以一起编辑，结果会保存在这里。</p>
      <button type="button" className="mx-auto mt-3 rounded-lg border px-3 py-2 text-xs font-semibold" style={{ borderColor: 'var(--isl-border)' }} onClick={onCreateProject}>创建项目</button>
    </div>
  );
}

function BriefPanel({ project }: { project: WorkflowProject }) {
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
