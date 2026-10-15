import { Check, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { discoverAgentHosts, type AgentHostDiscovery, type AgentHostRecord } from '../../services/agentHostDiscovery';
import { prepareAgent } from '../../services/link/hostActivation';
import { toLinkPublicStatus, type LinkPublicStatus } from '../../services/link/publicStatus';
import { useAgentConnectionStore } from '../../stores/useAgentConnectionStore';
import registry from '../../tools/flovart/contracts/host-registry.v1.json';
import { AgentHostDiagnostics } from './AgentHostDiagnostics';
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

function statusDot(state: LinkPublicStatus['state']) {
  return state === 'ready' ? 'var(--isl-mint)' : state === 'offline' ? 'var(--isl-coral)' : 'var(--isl-sun)';
}

function actionLabel(status: LinkPublicStatus, hostLabel: string, language: 'en' | 'zho'): string {
  switch (status.action) {
    case 'setup': return language === 'zho' ? '设置' : 'Set up';
    case 'login': return language === 'zho' ? '登录' : 'Sign in';
    case 'repair': return language === 'zho' ? '重试' : 'Retry';
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
    aria: '协作 Agent', title: '协作 Agent', description: '选择你习惯的助手，Flovart 会准备当前项目。', refresh: '刷新协作状态', current: '当前协作 Agent', currentAgent: '当前 Agent', selected: '已选择', ready: '已准备',
    workflow: '当前 Workflow', preparing: '正在准备…', inUse: '当前使用', messageReady: '已选择并准备连接。', others: '其他 Agent', switchHint: '可随时切换', active: '当前协作 Agent', diagnostics: '高级诊断',
    state: { ready: '已准备', needs_setup: '需安装', needs_login: '需登录', offline: '离线' },
    message: { ready: '可以操作当前项目。', needs_setup: '先安装或导入这个助手的 Flovart 入口。', needs_login: '请先登录这个助手，再回来继续。', offline: 'Flovart 本地服务暂时离线。' },
  } : {
    aria: 'Collaborating Agent', title: 'Collaborating agent', description: 'Choose the assistant you prefer. Flovart will prepare it for this project.', refresh: 'Refresh connection status', current: 'Current collaborating agent', currentAgent: 'Current agent', selected: 'Selected', ready: 'Ready',
    workflow: 'Current Workflow', preparing: 'Preparing…', inUse: 'In use', messageReady: 'is selected and ready to connect.', others: 'Other agents', switchHint: 'Switch at any time', active: 'Current collaborating agent', diagnostics: 'Advanced diagnostics',
    state: { ready: 'Ready', needs_setup: 'Setup needed', needs_login: 'Sign in required', offline: 'Offline' },
    message: { ready: 'Ready to work with the current project.', needs_setup: 'Install or import the Flovart entry point for this assistant.', needs_login: 'Sign in to this assistant, then return here.', offline: 'Flovart local service is currently offline.' },
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
  const localizedStatusMessage = (status: LinkPublicStatus) => copy.message[status.state];
  const selectedBusy = pendingId === selectedHost.id;

  return (
    <section className="agent-host-picker" data-testid="agent-host-picker" aria-label={copy.aria}>
      <header className="agent-picker__header">
        <div>
          <span className="agent-picker__eyebrow">{zh ? 'AI 协作' : 'AI COLLABORATION'}</span>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <button type="button" onClick={() => void scan()} disabled={scanning || Boolean(pendingId)} className="agent-picker__refresh" aria-label={copy.refresh} title={zh ? '刷新' : 'Refresh'}><RefreshCw size={15} /></button>
      </header>

      <div className="agent-picker__layout">
        <section className="agent-picker__current" aria-label={copy.current}>
          <div className="agent-picker__current-head">
            <span className="agent-picker__dot" style={{ background: statusDot(selectedStatus.state) }} />
            <div>
              <span className="agent-picker__eyebrow">{copy.currentAgent}</span>
              <h3>{selectedHost.label}</h3>
              <p>{selectedActive ? copy.selected : copy.state[selectedStatus.state]}</p>
            </div>
            <span className="agent-picker__badges">
              <span className={`agent-picker__badge agent-picker__badge--tier${hostReadiness(selectedHost.id, language).experimental ? ' is-experimental' : ''}`}>{hostReadiness(selectedHost.id, language).label}</span>
              <span className="agent-picker__badge">{selectedActive ? copy.ready : copy.state[selectedStatus.state]}</span>
            </span>
          </div>
          {projectTitle && <div className="agent-picker__current-workflow"><p>{copy.workflow}</p><strong title={projectTitle}>{projectTitle}</strong></div>}
          <button type="button" className="agent-picker__primary-action" disabled={selectedActive || Boolean(pendingId)} onClick={() => void useHost(selectedHost.id)}>{selectedBusy ? copy.preparing : selectedActive ? copy.inUse : actionLabel(selectedStatus, selectedHost.label, language)}</button>
          <p className="agent-picker__message">{selectedActive ? (zh ? `${selectedHost.label} ${copy.messageReady}` : `${selectedHost.label} ${copy.messageReady}`) : localizedStatusMessage(selectedStatus)}</p>
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
                  <span aria-hidden="true" className="agent-card__dot" style={{ background: statusDot(status.state) }} />
                  <button type="button" onClick={() => selectHost(id)} aria-pressed={selectedId === id} className="agent-card__body">
                    <strong>{host.label}</strong>
                    <span>{active ? copy.selected : copy.state[status.state]}</span>
                    <span className={`agent-card__state${readiness.experimental ? ' is-experimental' : ''}`}>{readiness.label}</span>
                  </button>
                  {active ? <Check size={15} style={{ color: 'var(--isl-mint-deep)' }} aria-label={copy.active} /> : <button type="button" disabled={Boolean(pendingId)} onClick={() => void useHost(id)} className="agent-card__action">{busy ? copy.preparing : actionLabel(status, host.label, language)}</button>}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="agent-picker__status-row">
        {failure && <p role="alert" className="agent-picker__message agent-picker__message--error">{failure}</p>}
        {notice && <p role="status" className="agent-picker__message" data-testid="agent-projection-status">{notice}</p>}
      </div>

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
