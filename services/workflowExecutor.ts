import { nanoid } from 'nanoid';
import type { CanonicalGenerationInput } from '../components/workflow/inputResolver';
import type { PromptIntent } from '../components/workflow/promptIntent';

export type WorkflowExecutionSurface = 'ui' | 'browser-agent' | 'dsh' | 'cli' | 'runtime' | 'recovery';

export type WorkflowRunErrorCode =
  | 'INPUT_RESOLUTION_FAILED'
  | 'RESOURCE_NOT_EXECUTABLE'
  | 'UNSUPPORTED_INPUT_MODE'
  | 'REVISION_CONFLICT'
  | 'PROVIDER_VALIDATION_FAILED'
  | 'PROVIDER_REQUEST_FAILED'
  | 'RUN_FAILED';

export interface WorkflowRunCommand {
  projectId: string;
  nodeId: string;
  expectedRevision?: number;
  promptIntent?: PromptIntent;
}

export interface WorkflowExecutionContext {
  surface: WorkflowExecutionSurface;
  correlationId?: string;
  runId?: string;
  resumeProviderTaskId?: string;
}

export interface WorkflowRunFailure {
  code: WorkflowRunErrorCode;
  message: string;
}

/** Opaque result identity for a Host to request the committed Artifact. */
export interface WorkflowArtifactOutput {
  artifactId: string;
  kind: 'image' | 'video' | 'audio';
  mimeType: string;
  name?: string;
}

export interface WorkflowRunResult {
  runId: string;
  projectId: string;
  nodeId: string;
  status: 'completed' | 'failed';
  error?: WorkflowRunFailure;
  artifact?: WorkflowArtifactOutput;
  /** 只供执行追踪和测试使用，不由 Dispatcher 回传给外部 Agent。 */
  canonicalInput?: CanonicalGenerationInput;
}

export interface WorkflowExecutor {
  runNode(command: WorkflowRunCommand, context?: WorkflowExecutionContext): Promise<WorkflowRunResult>;
  stopNode?(command: WorkflowRunCommand, context?: WorkflowExecutionContext): Promise<void> | void;
}

export interface WorkflowExecutorAdapters {
  runNode(command: WorkflowRunCommand, context: WorkflowExecutionContext): Promise<WorkflowRunAdapterResult | void> | WorkflowRunAdapterResult | void;
  stopNode?(command: WorkflowRunCommand, context: WorkflowExecutionContext): Promise<void> | void;
}

export interface WorkflowRunAdapterResult {
  status?: 'completed' | 'failed';
  error?: WorkflowRunFailure;
  artifact?: WorkflowArtifactOutput;
  canonicalInput?: CanonicalGenerationInput;
}

export interface WorkflowExecutorOptions {
  createRunId?: () => string;
}

export class WorkflowExecutionError extends Error {
  readonly code: WorkflowRunErrorCode;
  readonly runId?: string;
  readonly cause: unknown;

  constructor(code: WorkflowRunErrorCode, message: string, runId?: string, cause?: unknown) {
    super(message);
    this.name = 'WorkflowExecutionError';
    this.code = code;
    this.runId = runId;
    this.cause = cause;
  }
}

const ERROR_CODES = new Set<WorkflowRunErrorCode>([
  'INPUT_RESOLUTION_FAILED',
  'RESOURCE_NOT_EXECUTABLE',
  'UNSUPPORTED_INPUT_MODE',
  'REVISION_CONFLICT',
  'PROVIDER_VALIDATION_FAILED',
  'PROVIDER_REQUEST_FAILED',
  'RUN_FAILED',
]);

function errorCode(cause: unknown): WorkflowRunErrorCode | undefined {
  if (!cause || typeof cause !== 'object' || !('code' in cause)) return undefined;
  const code = (cause as { code?: unknown }).code;
  return typeof code === 'string' && ERROR_CODES.has(code as WorkflowRunErrorCode) ? code as WorkflowRunErrorCode : undefined;
}

function inferErrorCode(message: string): WorkflowRunErrorCode {
  if (/版本|revision|过期|冲突/i.test(message)) return 'REVISION_CONFLICT';
  if (/不支持|unsupported|图生图|图生视频|首帧|末帧/i.test(message)) return 'UNSUPPORTED_INPUT_MODE';
  if (/校验|validation/i.test(message)) return 'PROVIDER_VALIDATION_FAILED';
  if (/不可执行|artifact|媒体.*缺失|资源.*缺失|无法.*(媒体|资源)/i.test(message)) return 'RESOURCE_NOT_EXECUTABLE';
  if (/解析|引用|mention|resource|节点.*不存在/i.test(message)) return 'INPUT_RESOLUTION_FAILED';
  if (/provider|线路|请求|http|api/i.test(message)) return 'PROVIDER_REQUEST_FAILED';
  return 'RUN_FAILED';
}

export function normalizeWorkflowExecutionError(cause: unknown, runId?: string): WorkflowExecutionError {
  if (cause instanceof WorkflowExecutionError) {
    return cause.runId === runId || !runId ? cause : new WorkflowExecutionError(cause.code, cause.message, runId, cause);
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return new WorkflowExecutionError(errorCode(cause) || inferErrorCode(message), message, runId, cause);
}

const defaultRunId = () => `run_${nanoid()}`;

/** 所有入口共享的执行 seam；surface 只携带追踪/审计上下文，不改变执行语义。 */
export function createWorkflowExecutor(adapters: WorkflowExecutorAdapters, options: WorkflowExecutorOptions = {}): WorkflowExecutor {
  const createRunId = options.createRunId || defaultRunId;
  return {
    runNode: async (command, context = { surface: 'ui' }) => {
      const runId = context.runId || createRunId();
      const executionContext = { ...context, runId };
      try {
        const result = await adapters.runNode(command, executionContext);
        const outcome = result && typeof result === 'object' ? result : undefined;
        return {
          runId,
          projectId: command.projectId,
          nodeId: command.nodeId,
          status: outcome?.status || 'completed',
          ...(outcome?.error ? { error: outcome.error } : {}),
          ...(outcome?.artifact ? { artifact: outcome.artifact } : {}),
          ...(outcome?.canonicalInput ? { canonicalInput: outcome.canonicalInput } : {}),
        };
      } catch (cause) {
        throw normalizeWorkflowExecutionError(cause, runId);
      }
    },
    stopNode: adapters.stopNode
      ? (command, context = { surface: 'ui' }) => adapters.stopNode!(command, context)
      : undefined,
  };
}
