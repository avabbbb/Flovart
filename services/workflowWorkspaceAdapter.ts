import { getManagedAgentConnection, type ManagedAgentConnection } from './managedAgentConnection';
import { WorkflowAgentBridge, type WorkflowAgentBridgeOptions } from './workflowAgentBridge';
import { useAgentConnectionStore } from '../stores/useAgentConnectionStore';
import { consumeBrowserWriterAutoActivation } from './agentConnectionBootstrap';

type AdapterStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
type AdapterBridge = Pick<WorkflowAgentBridge, 'connect' | 'disconnect' | 'pushSnapshot'>
  & Partial<Pick<WorkflowAgentBridge, 'activateWriter' | 'getClientId'>>;

interface WorkflowWorkspaceAdapterOptions {
  discover?: () => Promise<ManagedAgentConnection | null>;
  createBridge?: (options: WorkflowAgentBridgeOptions) => AdapterBridge;
  onStatus?: (status: AdapterStatus) => void;
  confirm?: (summary: string) => boolean | Promise<boolean>;
}

export class WorkflowWorkspaceAdapter {
  private bridge: AdapterBridge | null = null;
  private latestProject: unknown;
  private connected = false;
  private publishInFlight = false;
  private publishAgain = false;
  private lifecycleVersion = 0;
  private autoActivateWriter = false;
  private readonly discover: () => Promise<ManagedAgentConnection | null>;
  private readonly createBridge: (options: WorkflowAgentBridgeOptions) => AdapterBridge;

  constructor(private readonly options: WorkflowWorkspaceAdapterOptions = {}) {
    this.discover = options.discover || getManagedAgentConnection;
    this.createBridge = options.createBridge || (bridgeOptions => new WorkflowAgentBridge(bridgeOptions));
  }

  async start(project: unknown): Promise<AdapterStatus | 'unavailable'> {
    this.stop();
    const lifecycleVersion = this.lifecycleVersion;
    this.latestProject = project;
    const connection = await this.discover();
    if (lifecycleVersion !== this.lifecycleVersion) return 'disconnected';
    if (!connection) {
      useAgentConnectionStore.getState().setStatus('offline', {
        clientId: null,
        projectId: projectIdOf(project),
        revision: revisionOf(project),
        writerStatus: 'unknown',
        writerClientId: null,
        writerProjectId: null,
        error: null,
      });
      return 'unavailable';
    }
    this.autoActivateWriter = consumeBrowserWriterAutoActivation();
    this.bridge = this.createBridge({
      url: connection.url,
      token: connection.token,
      confirm: this.options.confirm,
      onEvent: (type, payload) => {
        const state = useAgentConnectionStore.getState();
        const writerClientId = typeof payload?.clientId === 'string' ? payload.clientId : null;
        if (type === 'writer_changed' && writerClientId) {
          useAgentConnectionStore.getState().setStatus(state.status, {
            writerStatus: writerClientId === this.bridge?.getClientId?.() ? 'active' : 'inactive',
            writerClientId,
            writerProjectId: typeof payload?.projectId === 'string' ? payload.projectId : null,
            error: null,
          });
        } else if (type === 'writer_unavailable') {
          useAgentConnectionStore.getState().setStatus(state.status, {
            writerStatus: 'revoked',
            writerClientId: null,
            writerProjectId: typeof payload?.projectId === 'string' ? payload.projectId : null,
            error: null,
          });
        } else if (type === 'host_writer_changed') {
          const active = payload?.active;
          useAgentConnectionStore.getState().setStatus(state.status, {
            activeHostIdentity: typeof active?.agentIdentity === 'string' ? active.agentIdentity : null,
            activeHostProjectId: typeof active?.projectId === 'string' ? active.projectId : null,
            error: null,
          });
        }
      },
      onStatus: status => {
        this.connected = status === 'connected';
        this.options.onStatus?.(status);
        useAgentConnectionStore.getState().setStatus(status === 'connected' ? 'ready' : status === 'error' ? 'error' : status === 'connecting' ? 'connecting' : 'offline', {
          url: connection.url,
          clientId: this.bridge?.getClientId?.() || null,
          projectId: projectIdOf(this.latestProject),
          revision: revisionOf(this.latestProject),
          error: status === 'error' ? 'Flovart Agent 连接中断。' : null,
        });
        if (this.connected) this.schedulePublish();
      },
    });
    useAgentConnectionStore.getState().setStatus('connecting', {
      url: connection.url,
      clientId: this.bridge.getClientId?.() || null,
      projectId: projectIdOf(project),
      revision: revisionOf(project),
      writerStatus: 'unknown',
      writerClientId: null,
      writerProjectId: null,
      error: null,
    });
    this.bridge.connect();
    return 'connecting';
  }

  update(project: unknown) {
    this.latestProject = project;
    useAgentConnectionStore.getState().setStatus(useAgentConnectionStore.getState().status, {
      projectId: projectIdOf(project),
      revision: revisionOf(project),
    });
    if (this.connected) this.schedulePublish();
  }

  stop() {
    this.lifecycleVersion += 1;
    this.connected = false;
    this.publishAgain = false;
    this.autoActivateWriter = false;
    this.bridge?.disconnect();
    this.bridge = null;
  }

  private schedulePublish() {
    if (this.publishInFlight) {
      this.publishAgain = true;
      return;
    }
    void this.publishLatest();
  }

  private async publishLatest() {
    if (!this.bridge || !this.connected || !this.latestProject) return;
    this.publishInFlight = true;
    try {
      do {
        this.publishAgain = false;
        await this.bridge.pushSnapshot(this.latestProject);
        if (this.autoActivateWriter && this.bridge.activateWriter) {
          this.autoActivateWriter = false;
          await this.bridge.activateWriter(projectIdOf(this.latestProject) || undefined);
        }
      } while (this.publishAgain && this.bridge && this.connected);
    } catch {
      this.options.onStatus?.('error');
    } finally {
      this.publishInFlight = false;
    }
  }
}

function projectIdOf(project: unknown) {
  return project && typeof project === 'object' && typeof (project as { id?: unknown }).id === 'string'
    ? (project as { id: string }).id
    : null;
}

function revisionOf(project: unknown) {
  if (!project || typeof project !== 'object') return null;
  const value = (project as { draftVersion?: unknown; revision?: unknown }).draftVersion
    ?? (project as { revision?: unknown }).revision;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
