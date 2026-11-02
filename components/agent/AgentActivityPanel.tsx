import { useEffect, useMemo, useState } from 'react';
import { AgentReceiptsSection } from './AgentReceiptsSection';
import { Activity, CheckCircle2, CircleDashed, MonitorSmartphone, RefreshCw, XCircle } from 'lucide-react';
import { getManagedAgentConnection } from '../../services/managedAgentConnection';
import { hydrateAgentActivity } from '../../services/agentActivity';
import { useAgentActivityStore, type AgentActivityEntry } from '../../stores/useAgentActivityStore';
import { useAgentConnectionStore } from '../../stores/useAgentConnectionStore';

type Lang = 'en' | 'zho';

const COMMAND_LABELS: Record<string, [string, string]> = {
  'workflow.inspect': ['查看画布', 'Read canvas'],
  'workflow.selection.get': ['查看选中内容', 'Read selection'],
  'workflow.apply': ['批量修改画布', 'Apply canvas changes'],
  'workflow.node.create': ['创建节点', 'Create node'],
  'workflow.node.create-connected': ['创建并连接节点', 'Create connected node'],
  'workflow.node.update': ['修改节点', 'Update node'],
  'workflow.node.delete': ['删除节点', 'Delete node'],
  'workflow.node.move': ['移动节点', 'Move node'],
  'workflow.node.resize': ['调整节点大小', 'Resize node'],
  'workflow.node.run': ['运行节点', 'Run node'],
  'workflow.node.stop': ['停止节点', 'Stop node'],
  'workflow.node.tool': ['节点工具', 'Node tool'],
  'workflow.connect': ['连接节点', 'Connect nodes'],
  'workflow.disconnect': ['断开连接', 'Disconnect nodes'],
  'workflow.select': ['选中节点', 'Select nodes'],
  'workflow.viewport.set': ['移动视角', 'Move view'],
};

const SOURCE_LABELS: Record<string, [string, string]> = {
  cli: ['命令行', 'Command line'],
  mcp: ['外部 Agent', 'External agent'],
  agent: ['内置助手', 'Built-in assistant'],
};

const pick = (pair: [string, string] | undefined, lang: Lang, fallback: string) => (pair ? (lang === 'zho' ? pair[0] : pair[1]) : fallback);

function timeOf(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function StatusIcon({ status }: { status: AgentActivityEntry['status'] }) {
  if (status === 'ok') return <CheckCircle2 size={14} style={{ color: 'var(--isl-mint)' }} />;
  if (status === 'error') return <XCircle size={14} style={{ color: '#e5484d' }} />;
  return <CircleDashed size={14} className="animate-spin" style={{ color: 'var(--isl-ink-soft)' }} />;
}

export function AgentActivityPanel({ language = 'zho' }: { language?: Lang }) {
  const zh = language === 'zho';
  const entries = useAgentActivityStore(state => state.entries);
  const windows = useAgentActivityStore(state => state.windows);
  const status = useAgentConnectionStore(state => state.status);
  const activeHost = useAgentConnectionStore(state => state.activeHostIdentity);
  const [refreshing, setRefreshing] = useState(false);
  const [agentFilter, setAgentFilter] = useState<string>('all');

  const refresh = async () => {
    setRefreshing(true);
    try {
      const connection = await getManagedAgentConnection();
      if (connection) await hydrateAgentActivity(connection);
    } catch {
      // the status line already reflects connection problems
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [status]);

  const agents = useMemo(() => [...new Set(entries.map(entry => entry.agentIdentity || entry.source))], [entries]);
  const visible = useMemo(
    () => [...entries].reverse().filter(entry => agentFilter === 'all' || (entry.agentIdentity || entry.source) === agentFilter),
    [entries, agentFilter],
  );

  const statusText = status === 'ready'
    ? (zh ? '已连接' : 'Connected')
    : status === 'connecting'
      ? (zh ? '正在连接…' : 'Connecting…')
      : status === 'auth_failed'
        ? (zh ? '连接已失效，请重新从启动器打开画布' : 'Link expired, reopen the canvas from the launcher')
        : (zh ? '未连接' : 'Not connected');
  const statusColor = status === 'ready' ? 'var(--isl-mint)' : status === 'connecting' ? 'var(--isl-ink-soft)' : '#e5484d';

  return (
    <section className="agent-connections-page__surface flex flex-col gap-4" data-testid="agent-activity-panel" aria-labelledby="agent-activity-title">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity size={16} />
          <h2 id="agent-activity-title" className="text-sm font-semibold">{zh ? '实时操作' : 'Live activity'}</h2>
          <span className="inline-flex items-center gap-1 text-xs" data-testid="agent-activity-status" style={{ color: statusColor }}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: statusColor }} />
            {statusText}
          </span>
          {activeHost ? (
            <span className="text-xs" style={{ color: 'var(--isl-ink-soft)' }}>
              {zh ? '当前操作者：' : 'In control: '}{activeHost}
            </span>
          ) : null}
        </div>
        <button type="button" onClick={() => void refresh()} className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs" style={{ borderColor: 'var(--isl-border)' }} disabled={refreshing}>
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          {zh ? '刷新' : 'Refresh'}
        </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--isl-border)' }}>
          <strong className="text-xs">{zh ? '已连接的画布窗口' : 'Connected canvas windows'}</strong>
          {windows.length === 0 ? (
            <p className="mt-2 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>{zh ? '还没有画布窗口接入。' : 'No canvas window connected yet.'}</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1" data-testid="agent-activity-windows">
              {windows.map((item, index) => (
                <li key={item.clientId} className="flex items-center gap-2 text-xs">
                  <MonitorSmartphone size={12} />
                  <span>{item.projectTitle || (zh ? '未命名画布' : 'Untitled canvas')} · {zh ? '窗口' : 'Window'} {index + 1}</span>
                  {item.active ? <span className="rounded px-1" style={{ background: 'var(--isl-surface)', color: 'var(--isl-mint)' }}>{zh ? '正在接收操作' : 'Receiving actions'}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl border p-3" style={{ borderColor: 'var(--isl-border)' }}>
          <strong className="text-xs">{zh ? '怎么让外部 Agent 操作画布' : 'How to let an external agent work here'}</strong>
          <ol className="mt-2 list-decimal pl-4 text-xs" style={{ color: 'var(--isl-ink-soft)' }}>
            <li>{zh ? '保持这个画布窗口打开，上方显示“已连接”。' : 'Keep this canvas window open and connected.'}</li>
            <li>{zh ? '在上方选择要使用的 Agent，并切换为当前操作者。' : 'Pick the agent above and make it the one in control.'}</li>
            <li>{zh ? '在该 Agent 里直接说出要做的事，每一步都会出现在下方。' : 'Tell that agent what to do; each step appears below.'}</li>
          </ol>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs">
          <span style={{ color: 'var(--isl-ink-soft)' }}>{zh ? '显示' : 'Show'}</span>
          <select value={agentFilter} onChange={event => setAgentFilter(event.target.value)} className="rounded border bg-transparent px-1 py-0.5" style={{ borderColor: 'var(--isl-border)' }}>
            <option value="all">{zh ? '全部' : 'All'}</option>
            {agents.map(agent => <option key={agent} value={agent}>{pick(SOURCE_LABELS[agent], language, agent)}</option>)}
          </select>
          <span style={{ color: 'var(--isl-ink-ghost)' }}>{zh ? '最近 ' + visible.length + ' 条（重启后清空）' : visible.length + ' recent (cleared on restart)'}</span>
        </div>
        {visible.length === 0 ? (
          <p className="rounded-xl border p-4 text-center text-xs" style={{ borderColor: 'var(--isl-border)', color: 'var(--isl-ink-soft)' }}>
            {zh ? '还没有操作。外部 Agent 一开始工作，这里会实时出现每一步。' : 'No activity yet. Steps appear here as soon as an agent starts working.'}
          </p>
        ) : (
          <ol className="flex max-h-[420px] flex-col overflow-y-auto rounded-xl border" style={{ borderColor: 'var(--isl-border)' }} data-testid="agent-activity-feed">
            {visible.map(entry => (
              <li key={entry.id} className="flex items-start gap-2 border-b px-3 py-2 text-xs last:border-b-0" style={{ borderColor: 'var(--isl-border)' }}>
                <span className="mt-0.5"><StatusIcon status={entry.status} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <strong>{pick(COMMAND_LABELS[entry.command], language, entry.command)}</strong>
                    <span style={{ color: 'var(--isl-ink-soft)' }}>{entry.agentIdentity || pick(SOURCE_LABELS[entry.source], language, entry.source)}</span>
                    {entry.durationMs !== null ? <span style={{ color: 'var(--isl-ink-ghost)' }}>{entry.durationMs} ms</span> : null}
                  </div>
                  {entry.summary ? <div className="truncate" style={{ color: 'var(--isl-ink-soft)' }}>{entry.summary}</div> : null}
                  {entry.error ? <div style={{ color: '#e5484d' }}>{entry.error.message}</div> : null}
                </div>
                <time className="shrink-0 tabular-nums" style={{ color: 'var(--isl-ink-ghost)' }} dateTime={entry.at}>{timeOf(entry.at)}</time>
              </li>
            ))}
          </ol>
        )}
      </div>
      <AgentReceiptsSection language={language} />
    </section>
  );
}
