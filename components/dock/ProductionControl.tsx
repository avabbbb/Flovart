import { Boxes, Bot, CircleAlert, CircleDashed, Copy, LoaderCircle, Send, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/agent.css';
import type { WorkflowNode, WorkflowProject } from '../workflow/types';
import { DockCrewClient, DockClientError, loadDockAgentUrl, type DockConnection, type DockDirectorStatus, type DockIntent, type DockReceipt } from '../../services/dockCrewClient';
import { serializeSupportDiagnostics } from '../../services/supportDiagnostics';
import { useAgentConnectionStore } from '../../stores/useAgentConnectionStore';
import type { DockBadges } from './protocol';

export type ProductionControlMode = 'binding' | 'intents' | 'receipts' | 'events';

interface ProductionControlProps {
  project: WorkflowProject | null;
  client: DockCrewClient | null;
  connection: DockConnection | null;
  connectionReady: boolean;
  connectionError: DockClientError | null;
  onConnection: (url: string, token: string) => void;
  onEnsureConnection: () => Promise<boolean>;
  onOpenWorkflow: () => void;
  onOpenTable: (nodeId?: string) => void;
  onBadges: (badges: DockBadges) => void;
}

const STATUS_LABEL: Record<string, string> = {
  accepted: '已受理',
  inspecting: '检查现场',
  planning: '制定步骤',
  executing: '执行中',
  waiting: '待确认',
  partial: '部分完成',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
};

function statusClass(status: string) {
  if (['completed'].includes(status)) return 'is-ok';
  if (['waiting', 'partial'].includes(status)) return 'is-waiting';
  if (['failed', 'interrupted'].includes(status)) return 'is-error';
  if (['cancelled'].includes(status)) return 'is-muted';
  return 'is-running';
}

export function ProductionControl({ project, client, connection, connectionReady, connectionError, onConnection, onEnsureConnection, onOpenWorkflow, onOpenTable, onBadges }: ProductionControlProps) {
  const [mode, setMode] = useState<ProductionControlMode>('intents');
  const [director, setDirector] = useState<DockDirectorStatus | null>(null);
  const [intents, setIntents] = useState<DockIntent[]>([]);
  const [receipt, setReceipt] = useState<DockReceipt | null>(null);
  const [events, setEvents] = useState<{ eventId: number; eventType: string; data: Record<string, unknown> }[]>([]);
  const [url, setUrl] = useState(() => connection?.url || loadDockAgentUrl());
  const [token, setToken] = useState(() => connection?.token || '');
  const [goal, setGoal] = useState('');
  const [selectedIds, setSelectedIds] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [startingConnection, setStartingConnection] = useState(false);
  const eventCursor = useRef(0);
  const agentStatus = useAgentConnectionStore(state => state.status);
  const agentClientId = useAgentConnectionStore(state => state.clientId);
  const agentProjectId = useAgentConnectionStore(state => state.projectId);
  const agentRevision = useAgentConnectionStore(state => state.revision);
  const activeHostIdentity = useAgentConnectionStore(state => state.activeHostIdentity);
  const writerStatus = useAgentConnectionStore(state => state.writerStatus);

  useEffect(() => {
    if (!connection) return;
    setUrl(connection.url);
    setToken(connection.token);
  }, [connection]);

  const refreshDirector = useCallback(async () => {
    if (!client) return;
    try {
      const status = await client.directorStatus();
      setDirector(status);
      setError(null);
    } catch (cause) {
      setError(cause instanceof DockClientError ? cause.message : String(cause));
    }
  }, [client]);

  const refreshIntents = useCallback(async () => {
    if (!client) return;
    const pages: DockIntent[] = [];
    try {
      const events = await client.listEvents(0, 200);
      const intentIds = [...new Set(
        events.events
          .filter(event => event.eventType === 'crew.intent.accepted' || event.eventType === 'crew.intent.status_changed')
          .map(event => String(event.data.intentId || ''))
          .filter(Boolean),
      )];
      for (const intentId of intentIds.slice(-20)) {
        const { intent } = await client.getIntent(intentId);
        pages.push(intent);
      }
    } catch (cause) {
      if (cause instanceof DockClientError && cause.code === 'PROTOCOL_ERROR') setError(cause.message);
    }
    pages.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
    setIntents(pages.slice(0, 20));
  }, [client]);

  const refreshEvents = useCallback(async () => {
    if (!client) return;
    try {
      const page = await client.listEvents(eventCursor.current, 100);
      eventCursor.current = page.nextEventId;
      setEvents(previous => [...page.events.slice(-30).reverse(), ...previous].slice(0, 60));
    } catch {
      // 事件流失败不阻断面板；下一次轮询自动恢复
    }
  }, [client]);

  useEffect(() => {
    if (!client) return;
    void refreshDirector();
    void refreshIntents();
    void refreshEvents();
    const timer = setInterval(() => {
      void refreshDirector();
      void refreshEvents();
    }, 6000);
    return () => clearInterval(timer);
  }, [client, refreshDirector, refreshIntents, refreshEvents]);

  useEffect(() => {
    onBadges({
      waiting: intents.filter(intent => ['waiting', 'partial', 'accepted', 'inspecting', 'planning', 'executing'].includes(intent.status)).length,
      error: intents.filter(intent => ['failed', 'interrupted'].includes(intent.status)).length,
      artifacts: project?.nodes.filter(node => node.metadata.status === 'success').length || 0,
    });
  }, [intents, project, onBadges]);

  const openReceipt = useCallback(async (intentId: string) => {
    if (!client) return;
    setBusy(true);
    try {
      const { receipt } = await client.getReceipt(intentId);
      setReceipt(receipt);
      setMode('receipts');
    } catch (cause) {
      setError(cause instanceof DockClientError ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [client]);

  const cancelIntent = useCallback(async (intentId: string) => {
    if (!client) return;
    setBusy(true);
    try {
      await client.cancelIntent(intentId, 'dock-user-cancel');
      await refreshIntents();
    } catch (cause) {
      setError(cause instanceof DockClientError ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [client, refreshIntents]);

  const submitIntent = useCallback(async () => {
    if (!client || !project) return;
    if (!goal.trim()) { setError('请填写可验证的制作目标。'); return; }
    setBusy(true);
    setError(null);
    try {
      const ids = selectedIds.split(',').map(id => id.trim()).filter(Boolean);
      const submission = {
        goal: goal.trim(),
        scope: { workspace: 'workflow' as const, selectedObjectIds: ids },
        constraints: { maxSideEffect: 'draft-only', maxSteps: 12 },
        completion: { requiredOutputs: ['changeset', 'receipt'] },
      };
      await client.submitIntent({
        ...submission,
        idempotencyKey: `dock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        projectId: project.id,
      });
      setGoal('');
      setSelectedIds('');
      await refreshIntents();
    } catch (cause) {
      setError(cause instanceof DockClientError ? `${cause.code}：${cause.message}` : String(cause));
    } finally {
      setBusy(false);
    }
  }, [client, project, goal, selectedIds, refreshIntents]);

  const connect = useCallback(() => {
    if (!url.trim() || !token.trim()) { setError('请输入本机 Agent 地址与 Token。'); return; }
    onConnection(url.trim(), token.trim());
  }, [url, token, onConnection]);

  const startAndConnect = useCallback(async () => {
    setStartingConnection(true);
    try {
      if (!(await onEnsureConnection())) setAdvancedOpen(true);
    } finally {
      setStartingConnection(false);
    }
  }, [onEnsureConnection]);

  const copyCommand = useCallback(() => {
    const text = director?.binding
      ? `flovart director.status --json`
      : `flovart director.bind --agent-identity deepseek-harness --session-id <your-session> --project-id ${project?.id || '<project>'} --json`;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [director, project]);

  const copyDiagnostics = useCallback(async () => {
    if (!navigator.clipboard) {
      setError('当前环境不支持复制诊断信息。');
      return;
    }
    try {
      await navigator.clipboard.writeText(serializeSupportDiagnostics({
        appVersion: import.meta.env.VITE_APP_VERSION || '0.3.2',
        connectionUrl: connection?.url,
        connectionStatus: agentStatus,
        connectionErrorCode: connectionError?.code,
        clientId: agentClientId,
        projectId: agentProjectId,
        revision: agentRevision,
        activeHostIdentity: activeHostIdentity || director?.binding?.hostKind,
        writerStatus,
        project,
      }));
      setDiagnosticsCopied(true);
      window.setTimeout(() => setDiagnosticsCopied(false), 1200);
    } catch {
      setError('诊断信息复制失败，请重试。');
    }
  }, [activeHostIdentity, agentClientId, agentProjectId, agentRevision, agentStatus, connection, connectionError, director, project, writerStatus]);

  const mediaNodes = useMemo(() => project?.nodes.filter(node => node.type === 'image' || node.type === 'video') || [], [project]);

  // 配对遵循本机 Agent 的显式连接流程：地址可从上次配对恢复，Token 只由用户或受信宿主提供。

  if (!client || !connectionReady) {
    const needsLogin = connectionError?.code === 'INVALID_TOKEN';
    const pairingTitle = needsLogin
      ? '需要重新连接本机 Agent'
      : connection
        ? '无法连接到 Flovart 本地服务'
        : '本地 Agent 服务尚未运行';
    const pairingMessage = needsLogin
      ? '当前连接凭据已失效。请在高级连接设置中重新输入本机配对信息。'
      : connection
        ? 'Flovart 会在本机服务恢复后自动重试，也可以打开高级设置立即重新连接。'
        : 'Flovart 会在启动时自动连接本机服务；如果你是开发者，也可以在高级设置中手动排障。';
    const currentAgent = connection ? 'DeepSeek Harness' : 'Codex';
    const agents = [
      { label: 'Codex', state: connectionReady ? 'ready' : 'offline', detail: connectionReady ? '本地服务已就绪' : '等待本地服务' },
      { label: 'WorkBuddy', state: 'needs_setup', detail: '可导入连接器' },
      { label: 'DeepSeek Harness', state: connectionReady ? 'ready' : 'needs_setup', detail: connectionReady ? '当前面板宿主' : '插件可用' },
      { label: 'Claude Code', state: 'needs_setup', detail: '尚未准备' },
      { label: 'OpenCode', state: 'needs_setup', detail: '尚未准备' },
      { label: 'Pi', state: 'needs_setup', detail: '尚未准备' },
    ].filter(agent => agent.label !== currentAgent);
    const stateLabel = (state: string) => ({ ready: '已就绪', needs_setup: '需要准备', needs_login: '需要登录', offline: '离线' }[state] || '离线');
    return (
      <main className="agent-link-surface dock-surface" data-testid="production-control">
        <header className="agent-link-surface__header">
          <span className="agent-link-surface__eyebrow">Local Agent</span>
          <h1>AI 协作</h1>
          <p>让 Codex、WorkBuddy 或 DeepSeek Harness 操作当前 Flovart Workflow。连接细节只在需要排障时展开。</p>
          <span className={`agent-link-surface__status${connectionReady ? ' is-ready' : ''}`} role="status"><i />{connectionReady ? '本地服务已就绪' : needsLogin ? '需要登录' : '本地服务离线'}</span>
        </header>

        <div className="agent-link-surface__grid">
          <section className="agent-link-surface__card agent-link-surface__current" aria-labelledby="agent-link-current-title">
            <Bot size={22} style={{ color: 'var(--isl-mint)' }} aria-hidden="true" />
            <h2 id="agent-link-current-title">{pairingTitle}</h2>
            <p>{pairingMessage}</p>
            <div className="agent-link-surface__workflow"><span>当前 Workflow</span><strong>{project?.title || '尚未选择 Workflow'}</strong></div>
            <button type="button" className="agent-link-surface__primary-action" disabled={startingConnection} aria-busy={startingConnection} onClick={() => connectionReady ? onOpenWorkflow() : needsLogin ? setAdvancedOpen(true) : void startAndConnect()}>{connectionReady ? '打开 Workflow' : needsLogin ? '打开高级连接设置' : startingConnection ? '正在启动本地服务…' : connection ? '重新连接并使用 Codex' : '启动并连接 Codex'}</button>
            {connectionError && !needsLogin && <div className="agent-link-surface__recovery" role="alert">
              <strong>无法连接到 Flovart 本地服务</strong>
              <span>可以自动修复，或查看开发者诊断。</span>
              <div><button type="button" disabled={startingConnection} onClick={() => void startAndConnect()}>自动修复</button><button type="button" onClick={() => setAdvancedOpen(true)}>查看诊断</button></div>
            </div>}
          </section>

          <section className="agent-link-surface__card" aria-labelledby="agent-link-agents-title">
            <h3 id="agent-link-agents-title">其他 Agent</h3>
            <p>选择已准备好的协作入口。</p>
            <div className="agent-link-surface__cards" role="list">
              {agents.map(agent => (
                <div key={agent.label} className="agent-link-card" role="listitem">
                  <span className="agent-link-card__dot" style={{ background: agent.state === 'ready' ? 'var(--isl-mint)' : agent.state === 'offline' ? 'var(--isl-coral)' : 'var(--isl-sun)' }} />
                  <div className="agent-link-card__body"><strong>{agent.label}</strong><span>{agent.detail}</span></div>
                  <span className="agent-link-card__state">{stateLabel(agent.state)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <details className="agent-link-surface__advanced" open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}>
          <summary>高级连接设置 · Developer connection</summary>
          <div className="agent-link-surface__advanced-body">
            <label>Agent 地址<input value={url} placeholder="http://127.0.0.1:17372" onChange={event => setUrl(event.target.value)} /></label>
            <label>Token<input value={token} type="password" placeholder="短期 Token" onChange={event => setToken(event.target.value)} /></label>
            {connectionError && <p className="agent-link-surface__error">{connectionError.message}</p>}
            <p className="agent-link-surface__diagnostic">手动连接仅用于开发者排障。Token 不会写入 URL；连接成功后只保留本次会话凭据。</p>
            <div className="agent-link-surface__advanced-actions">
              <button type="button" onClick={connect}><ShieldCheck size={14} />连接 Agent</button>
              <button type="button" onClick={() => void copyDiagnostics()}><Copy size={14} />{diagnosticsCopied ? '已复制诊断信息' : '复制诊断信息'}</button>
            </div>
          </div>
        </details>
      </main>
    );
  }

  return (
    <main className="agent-control-shell dock-surface" data-testid="production-control">
      <aside className="agent-control-shell__context">
        <header className="agent-context__header">
          <div><span>Production Control</span><strong>{project?.title || 'Flovart 制作台'}</strong></div>
        </header>
        <nav className="agent-context__tabs" aria-label="制作控制">
          <button type="button" aria-pressed={mode === 'intents'} onClick={() => setMode('intents')}><Sparkles size={14} />Intent</button>
          <button type="button" aria-pressed={mode === 'binding'} onClick={() => setMode('binding')}><ShieldCheck size={14} />绑定</button>
          <button type="button" aria-pressed={mode === 'events'} onClick={() => setMode('events')}><CircleDashed size={14} />事件</button>
        </nav>
        <section className="agent-context__body">
          {mode === 'intents' && (
            <div className="agent-dock-intents">
              <div className="agent-dock-submit">
                <textarea value={goal} placeholder="一句话可验证目标，例如：把当前选中的三张图片建立为并行图生视频分支" onChange={event => setGoal(event.target.value)} />
                <input value={selectedIds} placeholder="限定对象 ID（逗号分隔，可留空）" onChange={event => setSelectedIds(event.target.value)} />
                <div>
                  <button type="button" disabled={busy} onClick={submitIntent}><Send size={13} />提交有界 Intent</button>
                  <span>draft-only · 可撤销 ChangeSet</span>
                </div>
              </div>
              {error && <div className="agent-dock-error">{error}</div>}
              <div className="agent-dock-intent-list">
                {intents.length === 0 && <div className="agent-context-empty"><Sparkles size={22} /><span>还没有 Intent。提交一个后，执行状态会实时显示在这里。</span></div>}
                {intents.map(intent => (
                  <div key={intent.intentId} className={`agent-dock-intent ${statusClass(intent.status)}`}>
                    <div><strong>{intent.goal}</strong><span>{STATUS_LABEL[intent.status] || intent.status} · {new Date(intent.createdAt).toLocaleTimeString()}</span></div>
                    <div className="agent-dock-intent-actions">
                      <button type="button" onClick={() => void openReceipt(intent.intentId)}>Receipt</button>
                      {['accepted', 'inspecting', 'planning', 'executing', 'waiting'].includes(intent.status) && (
                        <button type="button" onClick={() => void cancelIntent(intent.intentId)}>取消</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {mode === 'binding' && <DirectorSummary director={director} project={project} onCopy={copyCommand} copied={copied} onCopyDiagnostics={() => void copyDiagnostics()} diagnosticsCopied={diagnosticsCopied} onUnbind={client ? () => void client.unbindDirector().then(refreshDirector) : undefined} />}
          {mode === 'events' && (
            <div className="agent-dock-events">
              {events.length === 0 && <div className="agent-context-empty"><CircleDashed size={22} /><span>事件流为空；断开重连后按游标恢复。</span></div>}
              {events.map(event => (
                <div key={event.eventId} className="agent-dock-event"><span>#{event.eventId}</span><strong>{event.eventType}</strong><small>{JSON.stringify(event.data).slice(0, 120)}</small></div>
              ))}
            </div>
          )}
        </section>
        <footer className="agent-context__footer">
          <span className={`agent-status ${director?.binding ? 'is-ok' : 'is-running'}`}><i />{director?.binding ? `已绑定 ${director.binding.hostKind}` : '未绑定导演'}</span>
          <button type="button" onClick={onOpenWorkflow}><Boxes size={13} />打开 Workflow</button>
        </footer>
      </aside>

      <section className="agent-control-shell__conversation" aria-label="制作现场">
        {mode === 'receipts' && receipt ? (
          <ReceiptView receipt={receipt} onClose={() => setMode('intents')} onOpenWorkflow={onOpenWorkflow} onOpenTable={onOpenTable} />
        ) : mode === 'receipts' ? (
          <div className="agent-context-empty"><LoaderCircle size={24} /><span>读取 Receipt…</span></div>
        ) : (
          <div className="agent-dock-live">
            <header><span>Crew 现场</span><strong>{intents.find(intent => ['accepted', 'inspecting', 'planning', 'executing', 'waiting'].includes(intent.status))?.goal || '当前无进行中 Intent'}</strong></header>
            <div className="agent-dock-live__grid">
              <section><strong>{intents.length}</strong><small>Intent 总数</small></section>
              <section><strong>{mediaNodes.filter(node => node.metadata.status === 'success').length}</strong><small>成功产物</small></section>
              <section><strong>{mediaNodes.length}</strong><small>媒体节点</small></section>
              <section><strong>{project?.draftVersion || 1}</strong><small>Draft v</small></section>
            </div>
            <ArtifactStrip nodes={mediaNodes} onOpenTable={onOpenTable} />
          </div>
        )}
      </section>
    </main>
  );
}

function DirectorSummary({ director, project, onCopy, copied, onCopyDiagnostics, diagnosticsCopied, onUnbind }: {
  director: DockDirectorStatus | null;
  project: WorkflowProject | null;
  onCopy: () => void;
  copied: boolean;
  onCopyDiagnostics: () => void;
  diagnosticsCopied: boolean;
  onUnbind?: () => void;
}) {
  return (
    <div className="agent-dock-director">
      <header><ShieldCheck size={16} /><strong>Director Session Binding</strong></header>
      {director?.binding ? (
        <>
          <dl>
            <div><dt>宿主</dt><dd>{director.binding.hostKind}</dd></div>
            <div><dt>Session</dt><dd>{director.binding.externalSessionId}</dd></div>
            <div><dt>Project</dt><dd>{director.binding.productionSessionId}</dd></div>
            <div><dt>最后同步</dt><dd>{new Date(director.binding.lastSeenAt).toLocaleString()}</dd></div>
          </dl>
          <p>完整对话仍在外部 Harness；此处只保存非秘密绑定、Intent、Receipt 与执行事实。</p>
          <div className="agent-dock-director-actions">
            <button type="button" onClick={onCopy}>{copied ? <CircleAlert size={13} /> : <Copy size={13} />}{copied ? '已复制' : '复制连接命令'}</button>
            <button type="button" onClick={onCopyDiagnostics}><Copy size={13} />{diagnosticsCopied ? '已复制诊断信息' : '复制诊断信息'}</button>
            {onUnbind && <button type="button" onClick={onUnbind}><X size={13} />归档绑定</button>}
          </div>
        </>
      ) : (
        <>
           <p className="agent-dock-director-empty">未绑定 Director。当前 Host Projection 必须显式建立或接管项目绑定。
           <code>flovart director.bind --agent-identity deepseek-harness --session-id &lt;session&gt;{project ? ` --project-id ${project.id}` : ''} --json</code></p>
           <div className="agent-dock-director-actions">
             <button type="button" onClick={onCopy}><Copy size={13} />{copied ? '已复制' : '复制绑定命令'}</button>
             <button type="button" onClick={onCopyDiagnostics}><Copy size={13} />{diagnosticsCopied ? '已复制诊断信息' : '复制诊断信息'}</button>
           </div>
        </>
      )}
    </div>
  );
}

function ReceiptView({ receipt, onClose, onOpenWorkflow, onOpenTable }: {
  receipt: DockReceipt;
  onClose: () => void;
  onOpenWorkflow: () => void;
  onOpenTable: (nodeId?: string) => void;
}) {
  return (
    <div className="agent-dock-receipt" data-testid="dock-receipt">
      <header>
        <span className={`dock-status ${statusClass(receipt.status)}`}>{STATUS_LABEL[receipt.status] || receipt.status}</span>
        <code>{receipt.intentId}</code>
        <button type="button" onClick={onClose}><X size={14} /></button>
      </header>
      <dl>
        {receipt.changeSetId && <div><dt>ChangeSet</dt><dd>{receipt.changeSetId}</dd></div>}
        {receipt.affectedObjectIds && receipt.affectedObjectIds.length > 0 && <div><dt>受影响对象</dt><dd>{receipt.affectedObjectIds.join(', ')}</dd></div>}
        {receipt.waiting && <div><dt>等待</dt><dd>{receipt.waiting.reason}{receipt.waiting.objectIds?.length ? `：${receipt.waiting.objectIds.join(', ')}` : ''}</dd></div>}
        {receipt.error && <div><dt>错误</dt><dd>{receipt.error.code}：{receipt.error.message}</dd></div>}
      </dl>
      <div className="agent-activity">
        {receipt.commands.map((command, index) => (
          <div key={`${command.command}-${index}`}>
            <strong>{command.command}{command.summary ? `：${command.summary}` : ''}</strong>
            <small>{command.ok ? '已执行' : `失败：${command.error?.message || '未知错误'}`}{command.changeSetId ? ` · ${command.changeSetId}` : ''}</small>
          </div>
        ))}
      </div>
      <footer>
        <button type="button" onClick={onOpenWorkflow}><Boxes size={13} />定位到 Workflow</button>
        <button type="button" onClick={() => onOpenTable(receipt.affectedObjectIds?.[0])}>送往 Table</button>
      </footer>
    </div>
  );
}

function ArtifactStrip({ nodes, onOpenTable }: { nodes: WorkflowNode[]; onOpenTable: (nodeId?: string) => void }) {
  const artifacts = nodes.filter(node => node.metadata.status === 'success').slice(0, 12);
  if (!artifacts.length) return <div className="agent-context-empty"><Boxes size={22} /><span>产物会自动汇集在这里。</span></div>;
  return <div className="agent-artifacts">{artifacts.map(node => <ArtifactTile key={node.id} node={node} onClick={() => onOpenTable(node.id)} />)}</div>;
}

function ArtifactTile({ node, onClick }: { node: WorkflowNode; onClick: () => void }) {
  return (
    <button type="button" className="agent-artifact-card" onClick={onClick}>
      <span><strong>{node.title}</strong><small>{node.metadata.status}</small></span>
    </button>
  );
}
