import { Bot, Boxes, CircleDot, Grid2X2, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import '../../styles/agent.css';
import { useWorkflowMediaUrl } from '../workflow/media';
import type { WorkflowNode, WorkflowProject } from '../workflow/types';
import { AgentHostPicker } from './AgentHostPicker';
import { FlovartAgentPanel } from './FlovartAgentPanel';
import type { AssetLibrary, UserApiKey } from '../../types';

interface AgentWorkspaceProps {
  project: WorkflowProject | null;
  onCreateProject: () => void;
  onOpenWorkflow: () => void;
  onOpenTable: (nodeId?: string) => void;
  assetLibrary?: AssetLibrary;
  userApiKeys?: UserApiKey[];
  onOpenSettings?: () => void;
}

export function AgentWorkspace({ project, onCreateProject, onOpenWorkflow, onOpenTable, assetLibrary, userApiKeys = [], onOpenSettings = () => undefined }: AgentWorkspaceProps) {
  const [embeddedOpen, setEmbeddedOpen] = useState(false);
  const [panelStatus, setPanelStatus] = useState<'idle' | 'running' | 'waiting' | 'done' | 'error'>('idle');
  const [activeContext, setActiveContext] = useState<'brief' | 'activity' | 'artifacts' | 'crew'>('artifacts');
  const mediaNodes = useMemo(() => project?.nodes.filter(node => node.type === 'image' || node.type === 'video') || [], [project]);

  if (!project) return <main className="agent-workspace-shell agent-workspace-shell--empty" data-testid="agent-main-workspace" style={{ color: 'var(--isl-ink)' }}><div className="mx-auto w-full max-w-3xl"><AgentHostPicker /><div className="mt-6 rounded-xl border p-6 text-center" style={{ borderColor: 'var(--isl-border)', background: 'var(--isl-surface)' }}><Bot className="mx-auto mb-3" size={26} style={{ color: 'var(--isl-mint)' }} /><strong>从一个新项目开始</strong><p className="mt-1 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>创建画布后，你和助手可以一起编辑，结果会保存在这里。</p><button type="button" className="mx-auto mt-3 rounded-lg border px-3 py-2 text-xs font-semibold" style={{ borderColor: 'var(--isl-border)' }} onClick={onCreateProject}>创建项目</button></div></div></main>;

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
          <button type="button" aria-pressed={activeContext === 'crew'} onClick={() => setActiveContext('crew')} className="agent-workspace-tabs__crew"><Bot size={14} />助手</button>
        </nav>
        <section className="agent-workspace-body">
          {activeContext === 'brief' && <BriefPanel project={project} onOpenWorkflow={onOpenWorkflow} />}
          {activeContext === 'activity' && <ActivityPanel project={project} />}
          {activeContext === 'artifacts' && <ArtifactsPanel nodes={mediaNodes} onOpenTable={onOpenTable} />}
          {activeContext === 'crew' && <div className="agent-context-empty"><Bot size={24} /><span>外部 Agent 负责当前项目；内置助手可按需打开。</span></div>}
        </section>
        <footer className="agent-workspace-footer">
          <span className={`agent-status is-${panelStatus}`}><i />{panelStatus === 'error' ? '异常' : panelStatus === 'running' ? '运行中' : panelStatus === 'waiting' ? '需确认' : panelStatus === 'done' ? '已完成' : '已准备'}</span>
          <button type="button" onClick={onOpenWorkflow}><Grid2X2 size={13} />打开 Workflow</button>
        </footer>
      </aside>
      <section className="agent-workspace-shell__conversation">
        <button type="button" className="agent-workspace-shell__mobile-back" onClick={() => setActiveContext('artifacts')}>← 返回上下文</button>
        {!embeddedOpen ? (
          <section className="agent-external-priority" aria-label="外部 Agent">
            <div className="agent-external-priority__content">
              <Bot size={28} style={{ color: 'var(--isl-mint)' }} />
              <h2>外部 Agent 优先</h2>
              <p>左侧 Codex 为 Beta 路径，其他标记「实验性」的助手尚未认证，可通过 Flovart 操作当前 Workflow。</p>
              <p className="agent-external-priority__hint">内置助手是可选的本地备用入口，不会自动接管项目。</p>
              <button type="button" onClick={() => setEmbeddedOpen(true)}>打开可选内置助手</button>
            </div>
          </section>
        ) : (
          <FlovartAgentPanel
            project={project}
            onActivityChange={setPanelStatus}
            onOpenSettings={onOpenSettings}
            assetLibrary={assetLibrary}
            userApiKeys={userApiKeys}
          />
        )}
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
