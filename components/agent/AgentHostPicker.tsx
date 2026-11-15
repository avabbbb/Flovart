import { Check, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { discoverAgentHosts, type AgentHostDiscovery, type AgentHostRecord } from '../../services/agentHostDiscovery';
import { describeAgentLinkIssue } from '../../services/agentLinkIssue';
import { prepareAgent } from '../../services/link/hostActivation';
import { toLinkPublicStatus, type LinkPublicStatus } from '../../services/link/publicStatus';
import { useAgentConnectionStore } from '../../stores/useAgentConnectionStore';
import registry from '../../tools/flovart/contracts/host-registry.v1.json';
import { AgentHostDiagnostics } from './AgentHostDiagnostics';
import { AgentLinkBadge } from './AgentLinkStatus';
import { AgentSetupGuide } from './AgentSetupGuide';
import '../../styles/agentLink.css';

const SELECTED_HOST_KEY = 'flovart.agent.selectedHost';
const PRIMARY_HOSTS = ['codex', 'workbuddy', 'deepseek-harness'];
// SUPPORT_MATRIX.md Closed Beta freeze: Codex is the promoted host; every other
// selectable host is experimental and must not render as equally ready.
const BETA_HOSTS: Record<string, true> = { codex: true };
function hostReadiness(id: string, language: 'en' | 'zho') {
  return BETA_HOSTS[id] ? { label: 'Beta', experimental: false } : { label: language === 'zho' ? '实验性' : 'Experimental', experimental: true };
}

function readSelectedHost() {
  try { return localStorage.getItem(SELECTED_HOST_KEY) || 'codex'; } catch { return 'codex'; }
}

function publicStatusFor(host: AgentHostRecord | undefined, connectionStatus: string, writerActive: boolean): LinkPublicStatus {
  return toLinkPublicStatus({
    service: connectionStatus === 'ready' || connectionStatus === 'connecting' || connectionStatus === 'error' ? connectionStatus : 'offline',
    // A ready local service is enough to classify an unavailable host as setup-needed.
    // Writer ownership is shown separately by `active`; treating it as a hard
    // prerequisite would incorrectly turn WorkBuddy/DSH setup into "offline".
    writerActive: writerActive || connectionStatus === 'ready',
    host: host || { available: false, status: 'unknown' },
  });
}

function actionLabel(status: LinkPublicStatus, hostLabel: string, language: 'en' | 'zho'): string {
  switch (status.action) {
    case 'setup': return language === 'zho' ? '设置' : 'Set up';
    case 'login': return language === 'zho' ? '登录' : 'Sign in';
    case 'repair': return language === 'zho' ? '重新连接' : 'Reconnect';
    default: return language === 'zho' ? `使用 ${hostLabel}` : `Use ${hostLabel}`;
  }
}

interface AgentHostPickerProps {
  projectTitle?: string;
  language?: 'en' | 'zho';
}

export function AgentHostPicker({ projectTitle, language = 'zho' }: AgentHostPickerProps) {
  const zh = language === 'zho';
  const copy = zh ? {
    aria: '协作 Agent', title: '协作 Agent', description: '选择你习惯的助手，Flovart 会准备当前项目。', refresh: '刷新协作状态', current: '当前协作 Agent', currentAgent: '当前 Agent', selected: '已选择',
    workflow: '当前 Workflow', preparing: '正在准备…', connecting: '正在连接…', waiting: '等待连接', connectingMessage: '正在连接本机 Agent，连上后即可选择协作助手。', inUse: '当前使用', messageReady: '已选择并准备连接。', others: '其他 Agent', switchHint: '可随时切换', active: '当前协作 Agent', link: '本机连接',
    state: { ready: '已准备', needs_setup: '需安装', needs_login: '需登录', offline: '离线' },
    message: { ready: '可以操作当前项目。', needs_setup: '按下方接入步骤安装这个助手的 Flovart 入口。', needs_login: '请先登录这个助手，再回来继续。', offline: 'Flovart 本地服务暂时离线。' },
  } : {
    aria: 'Collaborating Agent', title: 'Collaborating agent', description: 'Choose the assistant you prefer. Flovart will prepare it for this project.', refresh: 'Refresh connection status', current: 'Current collaborating agent', currentAgent: 'Current agent', selected: 'Selected',
    workflow: 'Current Workflow', preparing: 'Preparing…', connecting: 'Connecting…', waiting: 'Waiting for link', connectingMessage: 'Connecting to the local agent; pick an assistant once it is connected.', inUse: 'In use', messageReady: 'is selected and ready to connect.', others: 'Other agents', switchHint: 'Switch at any time', active: 'Current collaborating agent', link: 'Local link',
    state: { ready: 'Ready', needs_setup: 'Setup needed', needs_login: 'Sign in required', offline: 'Offline' },
    message: { ready: 'Ready to work with the current project.', needs_setup: 'Follow the steps below to install this assistant’s Flovart entry point.', needs_login: 'Sign in to this assistant, then return here.', offline: 'Flovart local service is currently offline.' },
  };
  const [discovery, setDiscovery] = useState<AgentHostDiscovery>({ ok: false, state: 'offline', agents: [] });
  const [selectedId, setSelectedId] = useState(readSelectedHost);
  const [scanning, setScanning] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const scanRequest = useRef(0);
  const actionRequest = useRef(0);
  const connectionStatus = useAgentConnectionStore(state => state.status);
  const linkIssue = useAgentConnectionStore(state => state.issue);
  const requestReconnect = useAgentConnectionStore(state => state.requestReconnect);
  const writerStatus = useAgentConnectionStore(state => state.writerStatus);
  const projectId = useAgentConnectionStore(state => state.projectId);
  const activeHostIdentity = useAgentConnectionStore(state => state.activeHostIdentity);
  const activeHostProjectId = useAgentConnectionStore(state => state.activeHostProjectId);

  const scan = useCallback(async () => {
    const request = ++scanRequest.current;
    setScanning(true);
    const result = await discoverAgentHosts();
    if (request !== scanRequest.current) return;
    setDiscovery(result);
    setScanning(false);
    if (result.state === 'ready') {
      useAgentConnectionStore.getState().setStatus(useAgentConnectionStore.getState().status, {
        activeHostIdentity: result.activeHostWriter?.agentIdentity || null,
        activeHostProjectId: result.activeHostWriter?.projectId || null,
      });
    }
  }, []);

  useEffect(() => {
    void scan();
    return () => { scanRequest.current++; };
  }, [scan, connectionStatus]);

  useEffect(() => {
    actionRequest.current++;
    setPendingId(null);
    setNotice('');
    setFailure('');
  }, [connectionStatus, projectId]);

  const selectHost = (id: string) => {
    actionRequest.current++;
    setSelectedId(id);
    setNotice('');
    setFailure('');
    try { localStorage.setItem(SELECTED_HOST_KEY, id); } catch { /* preference only */ }
  };

  const useHost = async (id: string) => {
    selectHost(id);
    // Without a working local link no host can be prepared: fix the link first.
    if (connectionStatus !== 'ready' && connectionStatus !== 'connecting') {
      requestReconnect();
      return;
    }
    const request = ++actionRequest.current;
    setPendingId(id);
    setFailure('');
    setNotice(copy.preparing);
    const result = await prepareAgent(id);
    if (request !== actionRequest.current) return;
    setPendingId(null);
    if (result.state === 'ready') {
      setNotice(result.notice);
      void scan();
    } else if (result.state === 'error') {
      setNotice('');
      setFailure(result.message);
    } else {
      setNotice(result.message);
    }
  };

  const selectedHost = registry.agentIdentities.find(host => host.id === selectedId) || registry.agentIdentities[0];
  if (!selectedHost) return null;
  const selectedDetected = discovery.agents.find(host => host.id === selectedHost.id);
  const selectedActive = activeHostIdentity === selectedHost.id && activeHostProjectId === projectId && writerStatus === 'active';
  const selectedStatus = publicStatusFor(selectedDetected, connectionStatus, selectedActive);
  const selectedBusy = pendingId === selectedHost.id;
  const selectedReadiness = hostReadiness(selectedHost.id, language);
  const issueCopy = linkIssue && connectionStatus !== 'ready' ? describeAgentLinkIssue(linkIssue.kind, language) : null;
  // While the link is still coming up nothing is known about the hosts yet:
  // say "waiting" instead of flashing "offline / reconnect".
  const linking = connectionStatus === 'connecting';
  const stateText = (state: LinkPublicStatus['state'], active: boolean) => (active ? copy.selected : linking && state === 'offline' ? copy.waiting : copy.state[state]);
  const statusMessage = selectedActive
    ? `${selectedHost.label} ${copy.messageReady}`
    : linking ? copy.connectingMessage
    : selectedStatus.state === 'offline' && issueCopy ? `${issueCopy.title}：${issueCopy.next}`.replace('：', zh ? '：' : ': ') : copy.message[selectedStatus.state];

  return (
    <section className="agent-host-picker" data-testid="agent-host-picker" aria-label={copy.aria}>
      <header className="agent-picker__header">
        <div className="agent-picker__header-text">
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <button type="button" onClick={() => void scan()} disabled={scanning || Boolean(pendingId)} className="agent-picker__refresh" aria-label={copy.refresh} title={copy.refresh}>
          <RefreshCw size={14} className={scanning ? 'animate-spin' : undefined} />
        </button>
      </header>

      <div className="agent-picker__linkrow">
        <span className="agent-picker__linklabel">{copy.link}</span>
        <AgentLinkBadge status={connectionStatus} reconnecting={connectionStatus === 'connecting' && Boolean(linkIssue)} language={language} issueKind={linkIssue?.kind} />
      </div>

      <div className="agent-picker__layout">
        <section className="agent-picker__current" aria-label={copy.current}>
          <div className="agent-picker__current-head">
            <span className={`agent-picker__dot is-${selectedActive ? 'ready' : linking ? 'waiting' : selectedStatus.state}`} aria-hidden="true" />
            <div className="agent-picker__current-name">
              <span className="agent-picker__eyebrow">{copy.currentAgent}</span>
              <h3 title={selectedHost.label}>{selectedHost.label}</h3>
            </div>
          </div>
          <div className="agent-picker__badges">
            <span className={`agent-picker__badge agent-picker__badge--tier${selectedReadiness.experimental ? ' is-experimental' : ''}`}>{selectedReadiness.label}</span>
            <span className={`agent-picker__badge is-${selectedActive ? 'ready' : linking ? 'waiting' : selectedStatus.state}`}>{stateText(selectedStatus.state, selectedActive)}</span>
          </div>
          {projectTitle && <div className="agent-picker__current-workflow"><p>{copy.workflow}</p><strong title={projectTitle}>{projectTitle}</strong></div>}
          <button type="button" className="agent-picker__primary-action" disabled={selectedActive || Boolean(pendingId) || linking} onClick={() => void useHost(selectedHost.id)}>{selectedBusy ? copy.preparing : selectedActive ? copy.inUse : linking ? copy.connecting : actionLabel(selectedStatus, selectedHost.label, language)}</button>
          <p className="agent-picker__message">{statusMessage}</p>
        </section>

        <section className="agent-picker__others" aria-label={copy.others}>
          <div className="agent-picker__section-heading"><h3>{copy.others}</h3><p>{copy.switchHint}</p></div>
          <div className="agent-picker__list" role="list">
            {PRIMARY_HOSTS.filter(id => id !== selectedId).map(id => {
              const host = registry.agentIdentities.find(item => item.id === id)!;
              const detected = discovery.agents.find(item => item.id === id);
              const active = activeHostIdentity === id && activeHostProjectId === projectId && writerStatus === 'active';
              const status = publicStatusFor(detected, connectionStatus, active);
              const readiness = hostReadiness(id, language);
              const busy = pendingId === id;
              return (
                <div key={id} role="listitem" className="agent-card">
                  <span aria-hidden="true" className={`agent-card__dot is-${active ? 'ready' : linking ? 'waiting' : status.state}`} />
                  <button type="button" onClick={() => selectHost(id)} aria-pressed={selectedId === id} className="agent-card__body" title={host.label}>
                    <strong>{host.label}</strong>
                    <span className="agent-card__meta">
                      <span className="agent-card__status">{stateText(status.state, active)}</span>
                      <span className={`agent-card__state${readiness.experimental ? ' is-experimental' : ''}`}>{readiness.label}</span>
                    </span>
                  </button>
                  {active ? <Check size={15} className="agent-card__check" aria-label={copy.active} /> : <button type="button" disabled={Boolean(pendingId) || linking} onClick={() => void useHost(id)} className="agent-card__action">{busy ? copy.preparing : actionLabel(status, host.label, language)}</button>}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {(failure || notice) && (
        <div className="agent-picker__status-row">
          {failure && <p role="alert" className="agent-picker__message agent-picker__message--error">{failure}</p>}
          {notice && <p role="status" className="agent-picker__message" data-testid="agent-projection-status">{notice}</p>}
        </div>
      )}

      <AgentSetupGuide hostId={selectedHost.id} hostLabel={selectedHost.label} language={language} />

      <AgentHostDiagnostics
        scanning={scanning}
        diagnostic={discovery.error || selectedDetected?.diagnostic}
        selectedLabel={selectedHost.label}
        connectionStatus={connectionStatus}
        projectId={projectId}
        open={Boolean(failure)}
        language={language}
      />
    </section>
  );
}
