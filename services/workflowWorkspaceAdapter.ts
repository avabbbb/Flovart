import { getManagedAgentConnection, type ManagedAgentConnection } from './managedAgentConnection';
import { WorkflowAgentBridge, type WorkflowAgentBridgeOptions } from './workflowAgentBridge';
import { useAgentConnectionStore } from '../stores/useAgentConnectionStore';
import { consumeBrowserWriterAutoActivation, isAgentBootstrapInFlight } from './agentConnectionBootstrap';
import { hydrateAgentActivity, toActivityEntry } from './agentActivity';
import { hydrateAgentReceipts, toReceipt } from './agentReceipts';
import { useAgentReceiptStore } from '../stores/useAgentReceiptStore';
import { useAgentActivityStore } from '../stores/useAgentActivityStore';
import { agentLinkIssue, agentLinkIssueMessage, diagnoseAgentLink, isTerminalAgentLinkIssue, type AgentLinkIssue } from './agentLinkIssue';

type AdapterStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
type AdapterBridge = Pick<WorkflowAgentBridge, 'connect' | 'disconnect' | 'pushSnapshot'>
  & Partial<Pick<WorkflowAgentBridge, 'activateWriter' | 'getClientId' | 'reconnectNow'>>;

interface WorkflowWorkspaceAdapterOptions {
  discover?: () => Promise<ManagedAgentConnection | null>;
  createBridge?: (options: WorkflowAgentBridgeOptions) => AdapterBridge;
  onStatus?: (status: AdapterStatus) => void;
  confirm?: (summary: string) => boolean | Promise<boolean>;
  /** Classifies a broken link; injectable for tests. */
  diagnose?: (connection: ManagedAgentConnection) => Promise<AgentLinkIssue | null>;
  /**
   * Called when the credential can no longer work (expired / reset / origin
   * rejected). Returns true when it arranged a fresh credential itself, e.g.
   * the DSH embed asking its host for a new one-time bootstrap token.
   */
  onCredentialRejected?: (issue: AgentLinkIssue) => boolean;
}

export class WorkflowWorkspaceAdapter {
  private bridge: AdapterBridge | null = null;
  private latestProject: unknown;
  private connected = false;
  private publishInFlight = false;
  private publishAgain = false;
  private lifecycleVersion = 0;
  private autoActivateWriter = false;
  /** Set when the link hit an issue retrying cannot fix; later bridge statuses are ignored. */
  private halted = false;
  private diagnosing = false;
  private readonly diagnose: (connection: ManagedAgentConnection) => Promise<AgentLinkIssue | null>;
  private readonly discover: () => Promise<ManagedAgentConnection | null>;
  private readonly createBridge: (options: WorkflowAgentBridgeOptions) => AdapterBridge;

  constructor(private readonly options: WorkflowWorkspaceAdapterOptions = {}) {
    this.discover = options.discover || getManagedAgentConnection;
    this.createBridge = options.createBridge || (bridgeOptions => new WorkflowAgentBridge(bridgeOptions));
    this.diagnose = options.diagnose || (connection => diagnoseAgentLink({ url: connection.url, token: connection.token }));
  }

  async start(project: unknown): Promise<AdapterStatus | 'unavailable'> {
    this.stop();
    const lifecycleVersion = this.lifecycleVersion;
    this.latestProject = project;
    this.halted = false;
    let connection: ManagedAgentConnection | null;
    try {
      connection = await this.discover();
    } catch (cause) {
      // Desktop discovery threw (sidecar not ready / bad endpoint): report it instead of leaving a stale status.
      if (lifecycleVersion !== this.lifecycleVersion) return 'disconnected';
      const issue = agentLinkIssue('unreachable', null, cause instanceof Error ? cause.name : undefined);
      useAgentConnectionStore.getState().setStatus('offline', {
        clientId: null, projectId: projectIdOf(project), revision: revisionOf(project), error: agentLinkIssueMessage(issue), issue,
      });
      return 'unavailable';
    }
    if (lifecycleVersion !== this.lifecycleVersion) return 'disconnected';
    if (!connection) {
      // Bootstrap is still exchanging / probing: it owns the status and the
      // binding subscription restarts us when it succeeds. Writing "offline"
      // here only flashed a false "not connected" before every launch.
      if (isAgentBootstrapInFlight()) {
        const state = useAgentConnectionStore.getState();
        useAgentConnectionStore.getState().setStatus(state.status, { projectId: projectIdOf(project), revision: revisionOf(project) });
        return 'unavailable';
      }
      useAgentConnectionStore.getState().setStatus('offline', {
        clientId: null,
        projectId: projectIdOf(project),
        revision: revisionOf(project),
        writerStatus: 'unknown',
        writerClientId: null,
        writerProjectId: null,
        error: null,
        // Keep a classified bootstrap failure (auth / refused …) visible; otherwise there is simply nothing configured.
        issue: useAgentConnectionStore.getState().issue || agentLinkIssue('not_configured', null),
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
        } else if (type === 'activity') {
          const entry = toActivityEntry(payload);
          if (entry) useAgentActivityStore.getState().upsert(entry);
        } else if (type === 'receipt') {
          const receipt = toReceipt(payload);
          if (receipt) useAgentReceiptStore.getState().upsert(receipt);
        }
        if (type === 'writer_changed' || type === 'writer_unavailable' || type === 'hello') {
          void hydrateAgentActivity(connection).catch(() => undefined);
        }
      },
      onStatus: (status, reason) => {
        if (lifecycleVersion !== this.lifecycleVersion || this.halted) return;
        this.connected = status === 'connected';
        this.options.onStatus?.(status);
        const current = useAgentConnectionStore.getState();
        const mapped = status === 'connected' ? 'ready' : status === 'error' ? 'error' : status === 'connecting' ? 'connecting' : 'offline';
        useAgentConnectionStore.getState().setStatus(mapped, {
          url: connection.url,
          clientId: this.bridge?.getClientId?.() || null,
          projectId: projectIdOf(this.latestProject),
          revision: revisionOf(this.latestProject),
          // Until diagnosis finishes, show the cause we already know instead of a blank error.
          error: status === 'error' ? (current.issue ? current.error : agentLinkIssueMessage({ kind: reason === 'hello_timeout' ? 'timeout' : 'stream_lost' })) : null,
          ...(status === 'error' && !current.issue ? { issue: agentLinkIssue(reason === 'hello_timeout' ? 'timeout' : 'stream_lost', connection.url) } : {}),
        });
        if (status === 'error') void this.classify(connection, lifecycleVersion, 'stream_lost');
        if (this.connected) {
          this.schedulePublish();
          void hydrateAgentActivity(connection).catch(() => undefined);
          void hydrateAgentReceipts(connection, projectIdOf(this.latestProject)).catch(() => undefined);
        }
      },
    });
    this.connection = connection;
    useAgentConnectionStore.getState().setStatus('connecting', {
      url: connection.url,
      clientId: this.bridge.getClientId?.() || null,
      projectId: projectIdOf(project),
      revision: revisionOf(project),
      writerStatus: 'unknown',
      writerClientId: null,
      writerProjectId: null,
      error: null,
      issue: null,
    });
    this.bridge.connect();
    return 'connecting';
  }

  /** Retry now (user pressed Reconnect while the stream is in backoff). */
  reconnectNow() {
    this.bridge?.reconnectNow?.();
  }

  private connection: ManagedAgentConnection | null = null;

  /**
   * Classify a transport failure once per streak and publish it. Terminal
   * issues (expired credential, rejected origin, version skew) stop the
   * reconnect loop: hammering the Agent with a dead token every 15s cannot
   * succeed and only hides the real cause behind "connecting…".
   */
  private async classify(connection: ManagedAgentConnection, lifecycleVersion: number, fallback: 'stream_lost' | 'sync_failed', detail?: string) {
    if (this.diagnosing) return;
    this.diagnosing = true;
    let issue: AgentLinkIssue | null = null;
    try {
      issue = await this.diagnose(connection);
    } catch {
      issue = null;
    } finally {
      this.diagnosing = false;
    }
    if (lifecycleVersion !== this.lifecycleVersion || this.halted) return;
    // The stream recovered while we were probing: nothing to report.
    if (this.connected && fallback === 'stream_lost') return;
    const resolved = issue || agentLinkIssue(fallback, connection.url, detail);
    if (isTerminalAgentLinkIssue(resolved.kind)) {
      this.halted = true;
      this.connected = false;
      this.bridge?.disconnect();
      const rearmed = resolved.kind === 'auth' && this.options.onCredentialRejected?.(resolved) === true;
      useAgentConnectionStore.getState().setStatus(resolved.kind === 'auth' && !rearmed ? 'auth_failed' : rearmed ? 'connecting' : 'error', {
        url: connection.url,
        clientId: null,
        error: agentLinkIssueMessage(resolved),
        issue: resolved,
      });
      return;
    }
    useAgentConnectionStore.getState().setStatus('error', {
      error: agentLinkIssueMessage(resolved),
      issue: resolved,
    });
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
    this.halted = false;
    this.bridge?.disconnect();
    this.bridge = null;
    this.connection = null;
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
      // A previous sync failure must not stick once a publish succeeds again.
      const state = useAgentConnectionStore.getState();
      if (this.connected && state.status === 'error') {
        useAgentConnectionStore.getState().setStatus('ready', { error: null, issue: null });
      }
    } catch (cause) {
      this.options.onStatus?.('error');
      if (this.connection) void this.classify(this.connection, this.lifecycleVersion, 'sync_failed', cause instanceof Error ? cause.message.slice(0, 160) : undefined);
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
