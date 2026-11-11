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
  getDraftVersion?: () => number | undefined;
}

/** 只依赖运行时实际用到的内核方法，测试可注入替身。 */
export interface RuntimeKernel {
  openSession(): Promise<unknown>;
  close(): Promise<void>;
  subscribe(listener: RuntimeListener): () => void;
  snapshot(): Promise<unknown>;
  send(text: string, images?: ImageContent[], skillAttachment?: ProductionSkillAttachment | null): Promise<unknown>;
  cancel(): void;
  listSessions(): Promise<Array<{ id: string; title: string; updatedAt: string }>>;
  newSession(): Promise<unknown>;
  openSessionById(sessionId: string): Promise<unknown>;
  deleteSession(sessionId: string): Promise<void>;
  branchSession(fromSessionId: string, upto: string | readonly string[]): Promise<unknown>;
}

export type DelegatedTurnPolicy = 'read-only' | 'workspace-write';

export interface DelegatedTurnRequest {
  prompt: string;
  /** 指定则切到该会话再跑；省略则留在当前会话。 */
  sessionId?: string;
  policy?: DelegatedTurnPolicy;
  /** 幂等键：同一个键只跑一轮，重复调用返回同一结果。 */
  mutationId: string;
  caller?: string;
}

export interface DelegatedTurnResult {
  sessionId: string;
  text: string;
  toolCalls: Array<{ name: string; status: 'success' | 'error' }>;
  draftVersion?: number;
  /** 返回给编排者的文本被截断过（只回摘要，不回整段 transcript）。 */
  truncated?: boolean;
}

type RuntimeEvent = { type: string; [key: string]: unknown };
type RuntimeListener = (event: RuntimeEvent) => void;

/** 委派回合的错误码给命令面直接转成结构化错误。 */
export class AgentRuntimeError extends Error {
  constructor(readonly code: 'AGENT_BUSY' | 'AGENT_TURN_FAILED' | 'AGENT_RUNTIME_CLOSED' | 'BAD_REQUEST', message: string) {
    super(message);
    this.name = 'AgentRuntimeError';
  }
}

const MAX_SUMMARY_CHARACTERS = 6_000;
const TURN_LEDGER_LIMIT = 16;

const runtimes = new Map<string, BrowserAgentRuntime>();

interface SnapshotMessage {
  role?: string;
  text?: string;
  toolName?: string;
  isError?: boolean;
}

interface RuntimeSnapshot {
  sessionId?: string;
  running?: boolean;
  messages?: SnapshotMessage[];
}

/** 委派回合的默认策略：只读；调用方显式申请才允许写。 */
export function delegatedPolicyFor(policy?: DelegatedTurnPolicy): { sandbox: SandboxPolicy; approval: ApprovalPolicy } {
  return {
    sandbox: policy === 'workspace-write' ? 'workspace-write' : 'read-only',
    approval: 'on-request',
  };
}

export class BrowserAgentRuntime {
  private readonly listeners = new Set<RuntimeListener>();
  private readonly turnInFlight = new Map<string, Promise<DelegatedTurnResult>>();
  private readonly turnResults = new Map<string, DelegatedTurnResult>();
  private detach: (() => void) | undefined;
  private closed = false;
  private delegated = false;

  private constructor(
    readonly projectId: string,
    private readonly kernel: RuntimeKernel,
    private readonly policyState: { override: { sandbox: SandboxPolicy; approval: ApprovalPolicy } | null },
    private readonly getDraftVersion?: () => number | undefined,
  ) {}

  /** 创建并打开会话，注册到项目维度；同一项目后连的实例覆盖注册。 */
  static async connect(
    deps: BrowserAgentRuntimeDeps,
    options: { kernel?: RuntimeKernel } = {},
  ): Promise<BrowserAgentRuntime> {
    const policyState = { override: null as { sandbox: SandboxPolicy; approval: ApprovalPolicy } | null };
    const kernel = options.kernel ?? new BrowserAgentKernel({
      projectId: deps.projectId,
      route: deps.route,
      tools: createBrowserAgentTools({
        projectId: deps.projectId,
        confirm: deps.confirm,
        activeChangeSetId: '',
        getNodes: deps.getNodes,
        // 委派回合进行时强制套用只读/受限策略，不跟随面板模式。
        getPolicy: () => policyState.override ?? deps.getPolicy?.(),
        webSearch: deps.webSearch,
      }),
      confirm: deps.confirm,
      systemPrompt: deps.systemPrompt,
    });
    await kernel.openSession();
    const runtime = new BrowserAgentRuntime(deps.projectId, kernel, policyState, deps.getDraftVersion);
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

  /**
   * 外部 Agent 委派的一轮：默认只读、只回摘要、同一 mutationId 幂等、一次只跑一轮。
   * 调用方负责先确认（命令面在 write 委派时问用户）。
   */
  runDelegatedTurn(request: DelegatedTurnRequest): Promise<DelegatedTurnResult> {
    const mutationId = String(request.mutationId || '').trim();
    if (!mutationId) return Promise.reject(new AgentRuntimeError('BAD_REQUEST', 'agent.turn 需要 mutationId。'));
    if (!String(request.prompt || '').trim()) return Promise.reject(new AgentRuntimeError('BAD_REQUEST', 'agent.turn 需要 prompt。'));
    const cached = this.turnResults.get(mutationId);
    if (cached) return Promise.resolve(cached);
    const pending = this.turnInFlight.get(mutationId);
    if (pending) return pending;
    if (this.delegated) return Promise.reject(new AgentRuntimeError('AGENT_BUSY', '内置 Agent 正在执行委派回合，请稍后再试。'));
    // 同步占位：两次并发调用不能都走到 performDelegatedTurn 的异步检查。
    this.delegated = true;

    const promise = this.performDelegatedTurn({ ...request, mutationId })
      .then(result => {
        this.turnResults.set(mutationId, result);
        while (this.turnResults.size > TURN_LEDGER_LIMIT) {
          const oldest = this.turnResults.keys().next().value;
          if (oldest === undefined) break;
          this.turnResults.delete(oldest);
        }
        return result;
      })
      .finally(() => {
        this.delegated = false;
        this.turnInFlight.delete(mutationId);
      });
    this.turnInFlight.set(mutationId, promise);
    return promise;
  }

  private async performDelegatedTurn(request: DelegatedTurnRequest): Promise<DelegatedTurnResult> {
    if (this.closed) throw new AgentRuntimeError('AGENT_RUNTIME_CLOSED', '内置 Agent 已关闭，请重新打开画布后再试。');
    const before = await this.kernel.snapshot() as RuntimeSnapshot;
    if (before.running) throw new AgentRuntimeError('AGENT_BUSY', '内置 Agent 正在处理上一条消息，请稍后再试。');
    if (request.sessionId && request.sessionId !== before.sessionId) {
      await this.kernel.openSessionById(request.sessionId);
    }
    const baseline = ((await this.kernel.snapshot() as RuntimeSnapshot).messages || []).length;
    this.policyState.override = delegatedPolicyFor(request.policy);
    try {
      await this.kernel.send(request.prompt);
    } catch (cause) {
      throw new AgentRuntimeError('AGENT_TURN_FAILED', cause instanceof Error ? cause.message : String(cause));
    } finally {
      this.policyState.override = null;
    }
    const after = await this.kernel.snapshot() as RuntimeSnapshot;
    const messages = (after.messages || []).slice(baseline);
    const text = messages
      .filter(message => message.role === 'assistant' && message.text)
      .map(message => message.text as string)
      .join('\n\n')
      .trim();
    const toolCalls = messages
      .filter(message => message.role === 'tool')
      .map(message => ({ name: message.toolName || 'tool', status: message.isError ? 'error' as const : 'success' as const }));
    const truncated = text.length > MAX_SUMMARY_CHARACTERS;
    return {
      sessionId: String(after.sessionId || before.sessionId || ''),
      text: truncated ? `${text.slice(0, MAX_SUMMARY_CHARACTERS)}…` : text,
      toolCalls,
      ...(truncated ? { truncated } : {}),
      ...(this.getDraftVersion?.() === undefined ? {} : { draftVersion: this.getDraftVersion!() }),
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.detach?.();
    this.detach = undefined;
    this.listeners.clear();
    this.turnInFlight.clear();
    this.turnResults.clear();
    await this.kernel.close();
    if (runtimes.get(this.projectId) === this) runtimes.delete(this.projectId);
  }
}

/** 当前页面里该项目的活动运行时；没有或已关闭时返回 null。 */
export function getBrowserAgentRuntime(projectId: string): BrowserAgentRuntime | null {
  const runtime = runtimes.get(projectId);
  return runtime && !runtime.isClosed ? runtime : null;
}
