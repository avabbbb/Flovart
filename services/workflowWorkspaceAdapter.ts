import { getManagedAgentConnection, type ManagedAgentConnection } from './managedAgentConnection';
import { WorkflowAgentBridge, type WorkflowAgentBridgeOptions } from './workflowAgentBridge';

type AdapterStatus = 'connecting' | 'connected' | 'disconnected' | 'error';
type AdapterBridge = Pick<WorkflowAgentBridge, 'connect' | 'disconnect' | 'pushSnapshot'>;

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
    if (!connection) return 'unavailable';
    this.bridge = this.createBridge({
      url: connection.url,
      token: connection.token,
      confirm: this.options.confirm,
      onStatus: status => {
        this.connected = status === 'connected';
        this.options.onStatus?.(status);
        if (this.connected) this.schedulePublish();
      },
    });
    this.bridge.connect();
    return 'connecting';
  }

  update(project: unknown) {
    this.latestProject = project;
    if (this.connected) this.schedulePublish();
  }

  stop() {
    this.lifecycleVersion += 1;
    this.connected = false;
    this.publishAgain = false;
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
      } while (this.publishAgain && this.bridge && this.connected);
    } catch {
      this.options.onStatus?.('error');
    } finally {
      this.publishInFlight = false;
    }
  }
}
