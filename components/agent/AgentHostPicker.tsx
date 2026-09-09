import { Check, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { discoverAgentHosts, type AgentHostDiscovery, type AgentHostRecord } from '../../services/agentHostDiscovery';
import { createWorkBuddySkillPackage } from '../../services/agentSkillPackage';
import { ensureHostReady, LinkActivationError } from '../../services/link/hostActivation';
import { toLinkPublicStatus, type LinkPublicStatus } from '../../services/link/publicStatus';
import { useAgentConnectionStore } from '../../stores/useAgentConnectionStore';
import registry from '../../tools/flovart/contracts/host-registry.v1.json';
import { AgentHostDiagnostics } from './AgentHostDiagnostics';

const SELECTED_HOST_KEY = 'flovart.agent.selectedHost';
const PRIMARY_HOSTS = ['codex', 'workbuddy', 'deepseek-harness'];

function readSelectedHost() {
  try { return localStorage.getItem(SELECTED_HOST_KEY) || 'codex'; } catch { return 'codex'; }
}

function serviceState(status: string): 'ready' | 'connecting' | 'offline' | 'error' {
  return status === 'ready' || status === 'connecting' || status === 'error' ? status : 'offline';
}

function publicStatusFor(host: AgentHostRecord | undefined, connectionStatus: string, writerActive: boolean): LinkPublicStatus {
  return toLinkPublicStatus({
    service: serviceState(connectionStatus),
    browserConnected: connectionStatus === 'ready',
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

const PUBLIC_STATE_LABEL: Record<LinkPublicStatus['state'], string> = {
  ready: '已就绪',
  needs_setup: '需要准备',
  needs_login: '需要登录',
  offline: '离线',
};

interface AgentHostPickerProps {
  projectTitle?: string;
}

export function AgentHostPicker({ projectTitle }: AgentHostPickerProps) {
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

  const useWorkBuddy = async (request: number) => {
    const blob = await createWorkBuddySkillPackage();
    if (request !== actionRequest.current) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'flovart-workbuddy.zip';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('WorkBuddy 安装包已下载，导入后即可直接使用 Flovart。');
  };

  const useHost = async (id: string) => {
    selectHost(id);
    const request = ++actionRequest.current;
    setPendingId(id);
    setFailure('');
    setNotice('正在准备协作…');
    try {
      if (id === 'workbuddy') {
        await useWorkBuddy(request);
      } else if (id === 'deepseek-harness') {
        setNotice('DeepSeek Harness 插件尚未在当前环境就绪，请先完成插件安装。');
      } else {
        const result = await ensureHostReady(id);
        if (request !== actionRequest.current) return;
        if ('state' in result) {
          setNotice('这个助手尚未安装或准备完成。');
        } else {
          setNotice(`${registry.agentIdentities.find(host => host.id === id)?.label || id} 正在协作当前项目。`);
          void scan();
        }
      }
    } catch (error) {
      if (request !== actionRequest.current) return;
      setNotice('');
      setFailure(error instanceof LinkActivationError ? error.message : error instanceof Error ? error.message : '暂时无法使用这个助手。');
    } finally {
      if (request === actionRequest.current) setPendingId(null);
    }
  };

  const selectedHost = registry.agentIdentities.find(host => host.id === selectedId) || registry.agentIdentities[0];
  if (!selectedHost) return null;
  const selectedDetected = discovery.agents.find(host => host.id === selectedHost.id);
  const selectedActive = activeHostIdentity === selectedHost.id && activeHostProjectId === projectId && writerStatus === 'active';
  const selectedStatus = publicStatusFor(selectedDetected, connectionStatus, selectedActive);
  const selectedBusy = pendingId === selectedHost.id;
  const selectedActionLabel = selectedActive
    ? '当前使用'
    : selectedStatus.state === 'needs_setup'
      ? (selectedHost.id === 'workbuddy' ? '安装' : '启用')
      : `使用 ${selectedHost.label}`;

  return (
    <section className="agent-host-picker" data-testid="agent-host-picker" aria-label="协作 Agent">
      <header className="agent-picker__header">
        <div>
          <span className="agent-picker__eyebrow">AI collaboration</span>
          <h2>协作 Agent</h2>
          <p>选择你习惯的助手，Flovart 会准备当前项目。</p>
        </div>
        <button type="button" onClick={() => void scan()} disabled={scanning || Boolean(pendingId)} className="agent-picker__refresh" aria-label="刷新协作状态" title="刷新"><RefreshCw size={15} /></button>
      </header>

      <div className="agent-picker__layout">
        <section className="agent-picker__current" aria-label="当前协作 Agent">
          <div className="agent-picker__current-head">
            <span className="agent-picker__dot" style={{ background: statusDot(selectedStatus.state) }} />
            <div>
              <span className="agent-picker__eyebrow">当前 Agent</span>
              <h3>{selectedHost.label}</h3>
              <p>{selectedActive ? '正在协作当前项目' : selectedStatus.label}</p>
            </div>
            <span className="agent-picker__badge">{selectedActive ? '当前使用' : PUBLIC_STATE_LABEL[selectedStatus.state]}</span>
          </div>
          {projectTitle && <div className="agent-picker__current-workflow"><p>当前 Workflow</p><strong title={projectTitle}>{projectTitle}</strong></div>}
          <button type="button" className="agent-picker__primary-action" disabled={selectedActive || Boolean(pendingId)} onClick={() => void useHost(selectedHost.id)}>{selectedBusy ? '正在准备…' : selectedActionLabel}</button>
          <p className="agent-picker__message">{selectedActive ? `${selectedHost.label} 已获得当前项目的协作权。` : selectedStatus.message}</p>
        </section>

        <section className="agent-picker__others" aria-label="其他 Agent">
          <div className="agent-picker__section-heading"><h3>其他 Agent</h3><p>可随时切换</p></div>
          <div className="agent-picker__list" role="list">
            {PRIMARY_HOSTS.filter(id => id !== selectedId).map(id => {
              const host = registry.agentIdentities.find(item => item.id === id)!;
              const detected = discovery.agents.find(item => item.id === id);
              const active = activeHostIdentity === id && activeHostProjectId === projectId && writerStatus === 'active';
              const status = publicStatusFor(detected, connectionStatus, active);
              const busy = pendingId === id;
              return (
                <div key={id} role="listitem" className="agent-card">
                  <span aria-hidden="true" className="agent-card__dot" style={{ background: statusDot(status.state) }} />
                  <button type="button" onClick={() => selectHost(id)} aria-pressed={selectedId === id} className="agent-card__body">
                    <strong>{host.label}</strong>
                    <span>{active ? '正在协作当前项目' : status.label}</span>
                  </button>
                  {active ? <Check size={15} style={{ color: 'var(--isl-mint-deep)' }} aria-label="当前协作 Agent" /> : <button type="button" disabled={Boolean(pendingId)} onClick={() => void useHost(id)} className="agent-card__action">{busy ? '准备中…' : status.state === 'needs_setup' ? (id === 'workbuddy' ? '安装' : '启用') : `使用 ${host.label}`}</button>}
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
      />
    </section>
  );
}
