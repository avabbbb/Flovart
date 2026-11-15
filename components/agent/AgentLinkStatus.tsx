import { MonitorSmartphone, RefreshCw } from 'lucide-react';
import { describeAgentLinkIssue } from '../../services/agentLinkIssue';
import { useAgentActivityStore } from '../../stores/useAgentActivityStore';
import { useAgentConnectionStore, type AgentConnectionStatus } from '../../stores/useAgentConnectionStore';
import { AgentCopyButton } from './AgentCopyButton';
import '../../styles/agentLink.css';

type Lang = 'en' | 'zho';

export type LinkTone = 'ok' | 'busy' | 'idle' | 'bad';

/** "offline" is neutral only when nothing was configured; a classified failure is an error. */
function failedOffline(status: AgentConnectionStatus, issueKind?: string | null) {
  return status === 'offline' && Boolean(issueKind) && issueKind !== 'not_configured';
}

export function linkTone(status: AgentConnectionStatus, issueKind?: string | null): LinkTone {
  if (status === 'ready') return 'ok';
  if (status === 'connecting') return 'busy';
  if (status === 'offline') return failedOffline(status, issueKind) ? 'bad' : 'idle';
  return 'bad';
}

export function linkStatusLabel(status: AgentConnectionStatus, reconnecting: boolean, language: Lang, issueKind?: string | null): string {
  const zh = language === 'zho';
  if (failedOffline(status, issueKind)) return zh ? '连接失败' : 'Connection failed';
  switch (status) {
    case 'ready': return zh ? '已连接' : 'Connected';
    case 'connecting': return reconnecting ? (zh ? '正在重连…' : 'Reconnecting…') : (zh ? '正在连接…' : 'Connecting…');
    case 'auth_failed': return zh ? '凭证失效' : 'Credential expired';
    case 'error': return zh ? '连接中断' : 'Connection lost';
    default: return zh ? '未连接' : 'Not connected';
  }
}

function clock(iso: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Status dot + text; the dot alone never carries the meaning. */
export function AgentLinkBadge({ status, reconnecting = false, language = 'zho', issueKind = null }: { status: AgentConnectionStatus; reconnecting?: boolean; language?: Lang; issueKind?: string | null }) {
  const tone = linkTone(status, issueKind);
  return (
    <span className={`agent-linkbadge is-${tone}`} data-testid="agent-link-badge" data-status={status}>
      <span className="agent-linkbadge__dot" aria-hidden="true" />
      <span className="agent-linkbadge__text">{linkStatusLabel(status, reconnecting, language, issueKind)}</span>
    </span>
  );
}

export function AgentLinkStatus({ language = 'zho' }: { language?: Lang }) {
  const zh = language === 'zho';
  const status = useAgentConnectionStore(state => state.status);
  const url = useAgentConnectionStore(state => state.url);
  const issue = useAgentConnectionStore(state => state.issue);
  const since = useAgentConnectionStore(state => state.statusSince);
  const activeHost = useAgentConnectionStore(state => state.activeHostIdentity);
  const requestReconnect = useAgentConnectionStore(state => state.requestReconnect);
  const windows = useAgentActivityStore(state => state.windows);
  const reconnecting = status === 'connecting' && Boolean(issue);
  const copy = issue ? describeAgentLinkIssue(issue.kind, language) : null;
  const t = zh
    ? { title: '连接状态', since: '状态更新于', reconnect: '重新连接', address: '服务地址', none: '未获取', controller: '当前操作者', nobody: '暂无', windows: '已接入的画布窗口', noWindows: '还没有画布窗口接入。', untitled: '未命名画布', window: '窗口', receiving: '正在接收操作', copyUrl: '复制地址', copyDiag: '复制诊断信息', copied: '已复制', next: '下一步', healthy: '本机 Agent 在线，Agent 的每一步都会出现在「运行日志」。', copyCommand: '复制命令' }
    : { title: 'Connection status', since: 'Updated', reconnect: 'Reconnect', address: 'Service address', none: 'Unknown', controller: 'In control', nobody: 'Nobody yet', windows: 'Connected canvas windows', noWindows: 'No canvas window connected yet.', untitled: 'Untitled canvas', window: 'Window', receiving: 'Receiving actions', copyUrl: 'Copy address', copyDiag: 'Copy diagnostics', copied: 'Copied', next: 'Next step', healthy: 'The local agent is online; every agent step shows up in the Run log.', copyCommand: 'Copy command' };
  const diagnostics = [
    `status=${status}`,
    `issue=${issue?.kind || 'none'}${issue?.detail ? ` (${issue.detail})` : ''}`,
    `url=${url || issue?.url || 'none'}`,
    `since=${since || 'unknown'}`,
    `page=${typeof window === 'undefined' ? '' : window.location.origin}`,
  ].join('\n');

  return (
    <section className="agent-linkstatus" data-testid="agent-link-status" aria-labelledby="agent-link-status-title">
      <header className="agent-linkstatus__head">
        <div className="agent-linkstatus__heading">
          <h2 id="agent-link-status-title" className="agent-linkstatus__title">{t.title}</h2>
          <AgentLinkBadge status={status} reconnecting={reconnecting} language={language} issueKind={issue?.kind} />
        </div>
        <div className="agent-linkstatus__actions">
          <AgentCopyButton text={diagnostics} label={t.copyDiag} copiedLabel={t.copied} />
          <button
            type="button"
            className={`agent-linkstatus__reconnect${status === 'ready' ? ' is-quiet' : ''}`}
            onClick={requestReconnect}
            disabled={status === 'connecting' && !issue}
            title={t.reconnect}
            aria-label={t.reconnect}
          >
            <RefreshCw size={13} aria-hidden="true" className={status === 'connecting' ? 'animate-spin' : undefined} />
            <span>{t.reconnect}</span>
          </button>
        </div>
      </header>
      {since && <p className="agent-linkstatus__since">{t.since} <time dateTime={since}>{clock(since)}</time></p>}

      {copy ? (
        <div className={`agent-linkstatus__issue is-${linkTone(status, issue?.kind)}`} role={status === 'connecting' ? 'status' : 'alert'} data-testid="agent-link-issue" data-kind={issue?.kind}>
          <strong>{copy.title}</strong>
          <p>{copy.detail}</p>
          <p className="agent-linkstatus__next"><span>{t.next}</span>{copy.next}</p>
          {copy.command && (
            <div className="agent-steps__command">
              <code title={copy.command}>{copy.command}</code>
              <AgentCopyButton text={copy.command} label={t.copyCommand} copiedLabel={t.copied} />
            </div>
          )}
        </div>
      ) : status === 'ready' ? (
        <p className="agent-linkstatus__ok">{t.healthy}</p>
      ) : null}

      <dl className="agent-linkstatus__facts">
        <div className="agent-linkstatus__fact">
          <dt>{t.address}</dt>
          <dd>
            {url || issue?.url ? (
              <span className="agent-linkstatus__url">
                <code title={url || issue?.url || ''}>{url || issue?.url}</code>
                <AgentCopyButton text={url || issue?.url || ''} label={t.copyUrl} copiedLabel={t.copied} />
              </span>
            ) : <span className="agent-linkstatus__muted">{t.none}</span>}
          </dd>
        </div>
        <div className="agent-linkstatus__fact">
          <dt>{t.controller}</dt>
          <dd><span className="agent-linkstatus__ellipsis" title={activeHost || undefined}>{activeHost || <span className="agent-linkstatus__muted">{t.nobody}</span>}</span></dd>
        </div>
      </dl>

      <div className="agent-linkstatus__windows">
        <h3>{t.windows}</h3>
        {windows.length === 0 ? (
          <p className="agent-linkstatus__muted">{t.noWindows}</p>
        ) : (
          <ul data-testid="agent-activity-windows">
            {windows.map((item, index) => {
              const name = `${item.projectTitle || t.untitled} · ${t.window} ${index + 1}`;
              return (
                <li key={item.clientId}>
                  <MonitorSmartphone size={13} aria-hidden="true" />
                  <span className="agent-linkstatus__ellipsis" title={name}>{name}</span>
                  {item.active && <span className="agent-linkstatus__chip">{t.receiving}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
