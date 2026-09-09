import { Boxes, CircleDot, ExternalLink, Grid2X2, LayoutPanelLeft, PanelRightClose, PanelRightOpen, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../../styles/dock.css';
import { useWorkflowStore } from '../workflow/store';
import type { WorkflowProject } from '../workflow/types';
import { setBrowserWorkflowBinding } from '../../services/browserWorkflowBinding';
import { DockCrewClient, DockClientError, loadDockConnection, normalizeDockConnection, rememberDockConnection, type DockConnection } from '../../services/dockCrewClient';
import { getManagedAgentConnection } from '../../services/managedAgentConnection';
import { ProductionControl } from './ProductionControl';
import { DOCK_CHANNEL, DOCK_PROTOCOL_VERSION, isDockMessage, sendDockMessage, type DockBadges, type DockSurface } from './protocol';

interface DockPageProps {
  embedded?: boolean;
  agentUrl?: string;
  agentToken?: string;
}

const SURFACE_LABEL: Record<DockSurface, string> = {
  workflow: 'Workflow',
  table: 'Table',
  production: '制作控制',
};

export function DockPage({ embedded = false, agentUrl, agentToken }: DockPageProps) {
  const projects = useWorkflowStore(state => state.projects);
  const activeProjectId = useWorkflowStore(state => state.activeProjectId);
  const project = useMemo(
    () => projects.find(item => item.id === activeProjectId) || projects[0] || null,
    [projects, activeProjectId],
  );
  const [surface, setSurface] = useState<DockSurface>('production');
  const [connection, setConnection] = useState<DockConnection | null>(() => {
    if (agentUrl && agentToken) return { url: agentUrl, token: agentToken };
    return loadDockConnection();
  });
  const [connectionError, setConnectionError] = useState<DockClientError | null>(null);
  const [connectionReady, setConnectionReady] = useState(false);
  const [badges, setBadges] = useState<DockBadges>({ waiting: 0, error: 0, artifacts: 0 });
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const hostWindow = useRef<Window | null>(null);

  const client = useMemo(() => connection ? new DockCrewClient(connection) : null, [connection]);

  const ensureConnection = useCallback(async () => {
    try {
      const managed = await getManagedAgentConnection();
      if (!managed) return false;
      const next = normalizeDockConnection(managed.url, managed.token);
      setConnection(next);
      setConnectionReady(false);
      setConnectionError(null);
      return true;
    } catch {
      setConnectionError(new DockClientError('DOCK_UNAVAILABLE', '本地 Agent 尚未启动，请打开高级连接设置完成排障。', true));
      return false;
    }
  }, []);

  useEffect(() => {
    if (connection) return;
    let cancelled = false;
    void getManagedAgentConnection().then(managed => {
      if (cancelled || !managed) return;
      const next = normalizeDockConnection(managed.url, managed.token);
      setConnection(next);
      setConnectionReady(false);
    }).catch(() => {
      // The public surface remains usable while the local launcher is unavailable.
    });
    return () => { cancelled = true; };
  }, [connection]);

  useEffect(() => {
    setBrowserWorkflowBinding(connection && connectionReady
      ? { state: 'ready', url: connection.url, token: connection.token, managed: false }
      : null);
  }, [connection, connectionReady]);

  useEffect(() => {
    if (hostWindow.current) return;
    if (window.parent && window.parent !== window) hostWindow.current = window.parent;
  }, []);

  useEffect(() => {
    if (!hostWindow.current) return;
    sendDockMessage(hostWindow.current, {
      channel: DOCK_CHANNEL,
      version: DOCK_PROTOCOL_VERSION,
      type: 'ready',
      data: { protocolVersion: '1', registryHash: null, surface },
    });
  }, [surface]);

  const handleConnection = useCallback((url: string, token: string) => {
    try {
      const next = normalizeDockConnection(url, token);
      rememberDockConnection(next.url, next.token, true);
      setConnection(next);
      setConnectionReady(false);
      setConnectionError(null);
    } catch (cause) {
      setConnectionReady(false);
      setConnectionError(cause instanceof DockClientError
        ? cause
        : new DockClientError('INVALID_CONNECTION', '本机 Agent 连接参数无效。'));
    }
  }, []);

  // Harness 适配消息：主题、聚焦、会话绑定
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isDockMessage(event)) return;
      if (!embedded || (event.source && event.source !== window && event.source !== window.parent)) return;
      hostWindow.current = (event.source as Window) || (window.parent !== window ? window.parent : window);
      const message = event.data;
      if (message.type === 'handshake') {
        if (message.data?.agentUrl && message.data?.token) {
          handleConnection(message.data.agentUrl, message.data.token);
        } else {
          setConnectionError(new DockClientError('INVALID_HANDSHAKE', 'Harness 握手缺少本机 Agent 地址或 Token。'));
        }
      } else if (message.type === 'focus-surface') {
        setSurface(message.data?.surface === 'workflow' || message.data?.surface === 'table' ? message.data.surface : 'production');
      } else if (message.type === 'session.bound') {
        setConnectionError(null);
      } else if (message.type === 'session.unbound') {
        setConnectionError(null);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [embedded, handleConnection]);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client.protocol().then(protocol => {
      if (cancelled) return;
      setConnectionReady(true);
      setConnectionError(null);
      if (hostWindow.current) {
        sendDockMessage(hostWindow.current, {
          channel: DOCK_CHANNEL,
          version: DOCK_PROTOCOL_VERSION,
          type: 'ready',
          data: { protocolVersion: protocol.protocolVersion, registryHash: protocol.registryHash },
        });
      }
    }).catch(cause => {
      if (cancelled) return;
      setConnectionReady(false);
      setConnectionError(cause instanceof DockClientError
        ? cause
        : new DockClientError('DOCK_UNAVAILABLE', '本机 Agent 未运行或连接已断开。', true));
    });
    return () => { cancelled = true; };
  }, [client]);

  // Agent 离线或尚未配对时自动重试：
  // 1) 已有 connection（配对过）→ 每 5s 重试 protocol 握手，Agent 恢复后自动回到已连接；
  // 2) 无 connection → 每 3s 轮询 loadDockConnection()，用户在独立 Flovart 页完成一次
  //    配对后，本嵌入页无需刷新即可自动连上。
  useEffect(() => {
    if (client && connectionReady) return;
    if (connectionError?.code === 'INVALID_TOKEN') return;
    const timer = window.setInterval(() => {
      if (!client) {
        const stored = loadDockConnection();
        if (stored) setConnection(stored);
        return;
      }
      void client.protocol().then(() => {
        setConnectionReady(true);
        setConnectionError(null);
      }).catch(cause => {
        setConnectionReady(false);
        setConnectionError(cause instanceof DockClientError
          ? cause
          : new DockClientError('DOCK_UNAVAILABLE', '本机 Agent 未运行或连接已断开。', true));
      });
    }, client ? 5000 : 3000);
    return () => { window.clearInterval(timer); };
  }, [client, connectionError, connectionReady]);

  const handleBadges = useCallback((next: DockBadges) => {
    setBadges(next);
    if (hostWindow.current) {
      sendDockMessage(hostWindow.current, {
        channel: DOCK_CHANNEL,
        version: DOCK_PROTOCOL_VERSION,
        type: 'badges',
        data: next,
      });
    }
  }, []);

  const openWindow = useCallback(() => {
    const route = surface === 'production' ? '#/app' : '#/app';
    const url = new URL(window.location.href.split('#')[0]);
    url.hash = route;
    window.open(url.toString(), '_blank', 'noopener');
  }, [surface]);

  return (
    <div className={`dock-page${bridgeOpen ? ' is-bridge-open' : ''}`} data-testid="dock-page" data-embedded={embedded ? 'true' : 'false'}>
      <nav className="dock-rail" aria-label="Flovart Dock">
        <header>
          <LayoutPanelLeft size={17} />
          <strong>Flovart</strong>
          {embedded && <a href="#/app" target="_blank" rel="noreferrer" aria-label="在独立窗口中打开"><ExternalLink size={13} /></a>}
        </header>
        <div className="dock-rail__items">
          <button type="button" aria-label="Flovart Dock · 制作控制" aria-pressed={surface === 'production'} onClick={() => setSurface('production')}>
            <Sparkles size={16} />
            <span>制作控制</span>
            {(badges.waiting > 0 || badges.error > 0) && <i className="dock-badge is-alert">{(badges.waiting + badges.error) > 9 ? '9+' : badges.waiting + badges.error}</i>}
          </button>
          <button type="button" aria-label="Flovart Dock · Workflow" aria-pressed={surface === 'workflow'} onClick={() => setSurface('workflow')}>
            <Grid2X2 size={16} />
            <span>Workflow</span>
          </button>
          <button type="button" aria-label="Flovart Dock · Table" aria-pressed={surface === 'table'} onClick={() => setSurface('table')}>
            <Boxes size={16} />
            <span>Table</span>
          </button>
        </div>
        <footer>
          <button type="button" aria-label="切换协作 Agent" aria-pressed={bridgeOpen} onClick={() => setBridgeOpen(open => !open)}>
            {bridgeOpen ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
            <span>Bridge</span>
          </button>
        </footer>
      </nav>

      <section className="dock-surface" aria-label={SURFACE_LABEL[surface]}>
        {surface === 'production' ? (
          <ProductionControl
            project={project as WorkflowProject | null}
            client={client}
            connection={connection}
            connectionReady={connectionReady}
            connectionError={connectionError}
            onConnection={handleConnection}
            onEnsureConnection={ensureConnection}
            onOpenWorkflow={() => setSurface('workflow')}
            onOpenTable={() => setSurface('table')}
            onBadges={handleBadges}
          />
        ) : (
          <div className="dock-surface__placeholder">
            <Grid2X2 size={30} />
            <h2>{SURFACE_LABEL[surface]}</h2>
            <p>当前插件页承载制作控制面；{SURFACE_LABEL[surface]} 打开独立 Flovart 窗口操作，并共享同一 Runtime Session。</p>
            <button type="button" onClick={openWindow}><ExternalLink size={14} />打开 {SURFACE_LABEL[surface]} 窗口</button>
          </div>
        )}
      </section>

      {bridgeOpen && (
        <aside className="dock-bridge" aria-label="协作 Agent">
          <header className="dock-bridge__header"><CircleDot size={15} /><div><strong>协作 Agent</strong><span>选择可用的协作入口</span></div></header>
          <div className="dock-bridge__list" role="list">
            {[
              { label: 'Codex', state: connectionReady ? 'ready' : 'offline', detail: connectionReady ? '本地服务已就绪' : '等待本地服务' },
              { label: 'WorkBuddy', state: 'needs_setup', detail: '可导入连接器' },
              { label: 'DeepSeek Harness', state: connectionReady ? 'ready' : 'needs_setup', detail: connectionReady ? '当前面板宿主' : '插件可用' },
              { label: 'Claude Code', state: 'needs_setup', detail: '尚未准备' },
              { label: 'OpenCode', state: 'needs_setup', detail: '尚未准备' },
              { label: 'Pi', state: 'needs_setup', detail: '尚未准备' },
            ].map(agent => (
              <article key={agent.label} className="dock-bridge__card" role="listitem">
                <span className={`dock-bridge__dot is-${agent.state}`} />
                <div><strong>{agent.label}</strong><span>{agent.detail}</span></div>
                <small>{{ ready: '已就绪', needs_setup: '需要准备', needs_login: '需要登录', offline: '离线' }[agent.state] || '离线'}</small>
              </article>
            ))}
          </div>
          <details className="dock-bridge__diagnostics">
            <summary>开发者诊断</summary>
            <p>{connectionReady ? '本机 Agent 通道已验证。' : connection ? '已发现本机服务，但尚未完成验证。' : '尚未发现本机 Agent 连接。'}</p>
          </details>
        </aside>
      )}
    </div>
  );
}
