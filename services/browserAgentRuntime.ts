// 内置 Browser Agent 的运行时句柄：把 kernel 从 React 面板里抽出来，
// 让同一页面的其它服务（命令面 / 委派回合）能在项目维度拿到它。
// 面板仍是生命周期所有者：卸载时 close，行为与抽取前一致。
import type { ImageContent } from '@earendil-works/pi-ai';
import type { WorkflowNode } from '../components/workflow/types';
import type { AgentConfirmRequest } from './agentSpendMandate';
import type { AgentSearchCredential } from './agentWebSearch';
import type { ApprovalPolicy, SandboxPolicy } from './agentToolPolicy';
import type { ProductionSkillAttachment } from './productionSkillCatalog';
import {
  BrowserAgentKernel,
  createBrowserAgentTools,
  type BrowserAgentTextRoute,
} from './browserAgentKernel';

export interface BrowserAgentRuntimeDeps {
  projectId: string;
  route: BrowserAgentTextRoute;
  confirm: (summary: string, request?: AgentConfirmRequest) => Promise<boolean>;
  systemPrompt: string;
  getNodes?: () => readonly WorkflowNode[];
  getPolicy?: () => { sandbox: SandboxPolicy; approval: ApprovalPolicy };
  webSearch?: AgentSearchCredential;
}

type RuntimeEvent = { type: string; [key: string]: unknown };
type RuntimeListener = (event: RuntimeEvent) => void;

const runtimes = new Map<string, BrowserAgentRuntime>();

export class BrowserAgentRuntime {
  private readonly listeners = new Set<RuntimeListener>();
  private detach: (() => void) | undefined;
  private closed = false;

  private constructor(readonly projectId: string, private readonly kernel: BrowserAgentKernel) {}

  /** 创建并打开会话，注册到项目维度；同一项目后连的实例覆盖注册。 */
  static async connect(deps: BrowserAgentRuntimeDeps): Promise<BrowserAgentRuntime> {
    const kernel = new BrowserAgentKernel({
      projectId: deps.projectId,
      route: deps.route,
      tools: createBrowserAgentTools({
        projectId: deps.projectId,
        confirm: deps.confirm,
        activeChangeSetId: '',
        getNodes: deps.getNodes,
        getPolicy: deps.getPolicy,
        webSearch: deps.webSearch,
      }),
      confirm: deps.confirm,
      systemPrompt: deps.systemPrompt,
    });
    await kernel.openSession();
    const runtime = new BrowserAgentRuntime(deps.projectId, kernel);
    // 内核只订阅一次，运行时再分发给面板/命令面的监听者。
    runtime.detach = kernel.subscribe(event => {
      for (const listener of runtime.listeners) listener(event);
    });
    runtimes.set(deps.projectId, runtime);
    return runtime;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): Promise<unknown> {
    return this.kernel.snapshot();
  }

  send(text: string, images?: ImageContent[], skillAttachment?: ProductionSkillAttachment | null): Promise<unknown> {
    return this.kernel.send(text, images, skillAttachment);
  }

  cancel(): void {
    this.kernel.cancel();
  }

  listSessions(): Promise<Array<{ id: string; title: string; updatedAt: string }>> {
    return this.kernel.listSessions();
  }

  newSession(): Promise<unknown> {
    return this.kernel.newSession();
  }

  openSessionById(sessionId: string): Promise<unknown> {
    return this.kernel.openSessionById(sessionId);
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.kernel.deleteSession(sessionId);
  }

  branchSession(fromSessionId: string, upto: string | readonly string[]): Promise<unknown> {
    return this.kernel.branchSession(fromSessionId, upto);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.detach?.();
    this.detach = undefined;
    this.listeners.clear();
    await this.kernel.close();
    if (runtimes.get(this.projectId) === this) runtimes.delete(this.projectId);
  }
}

/** 当前页面里该项目的活动运行时；没有或已关闭时返回 null。 */
export function getBrowserAgentRuntime(projectId: string): BrowserAgentRuntime | null {
  const runtime = runtimes.get(projectId);
  return runtime && !runtime.isClosed ? runtime : null;
}
