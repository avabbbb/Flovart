import { getFlovartRuntimeApi, type FlovartRuntimeApi } from './flovartRuntime';
import { loadRuntimeArtifactBlob } from './runtimeArtifacts';

export interface RuntimeMediaResult {
  blob: Blob;
  mimeType: string;
  taskId: string;
  priceQuote?: { estimatedPrice?: number; currency?: string };
}

interface RuntimeTaskView {
  status?: string;
  result?: { artifact?: { mimeType?: string }; priceQuote?: { estimatedPrice?: number; currency?: string } };
  error?: unknown;
}

const GENERATION_COMMANDS = ['generate.image', 'generate.video'] as const;
type GenerationCommand = typeof GENERATION_COMMANDS[number];

const RUNTIME_POLL_TIMEOUT_MS = 600_000; // 与 aiGateway 各 provider 一致的 10 分钟硬上限
const RUNTIME_POLL_INTERVAL_MS = 2000;

async function waitForNextPoll(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const timer = setTimeout(resolve, RUNTIME_POLL_INTERVAL_MS);
  const onAbort = () => {
    clearTimeout(timer);
    reject(signal?.reason ?? new DOMException('已停止等待 Runtime 任务', 'AbortError'));
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await promise;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

async function pollRuntimeTask(runtime: FlovartRuntimeApi, taskId: string, onProgress?: (message: string) => void, signal?: AbortSignal): Promise<RuntimeTaskView> {
  const pollStart = Date.now();
  for (;;) {
    // 保留 signal.reason（默认是 AbortError），下游 isAbort 才能把停止和失败区分开。
    signal?.throwIfAborted();
    if (Date.now() - pollStart > RUNTIME_POLL_TIMEOUT_MS) {
      throw new Error('Runtime 生成超时（已等待超过 10 分钟）');
    }
    const task = await runtime.execute({
      protocolVersion: '1',
      commandId: crypto.randomUUID(),
      command: 'task.get',
      args: { taskId },
      actor: { kind: 'ui', instanceId: 'workflow-generation' },
    }) as RuntimeTaskView;
    const status = task?.status || '';
    if (status === 'completed' || status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'error') {
      return task;
    }
    onProgress?.(status === 'queued' ? '已提交给 Runtime，排队中…' : 'Runtime 生成中…');
    await waitForNextPoll(signal);
  }
}

/**
 * 通过 Desktop Production Runtime 执行一次媒体生成（用于 `runtimeManaged` 的
 * 「Runtime 托管」网页 Key）。明文 Key 只存在系统 Keyring，浏览器只提交
 * 非敏感参数并轮询任务，最终经受控 IPC 读回产物 Blob。
 */
export async function runRuntimeMediaGeneration(params: {
  command: GenerationCommand;
  args: Record<string, unknown>;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<RuntimeMediaResult> {
  const runtime = getFlovartRuntimeApi();
  if (!runtime) throw new Error('Runtime 媒体生成需要桌面应用');
  const idempotencyKey = crypto.randomUUID();
  const submitted = await runtime.execute({
    protocolVersion: '1',
    commandId: idempotencyKey,
    command: params.command,
    args: { ...params.args, idempotencyKey },
    actor: { kind: 'ui', instanceId: 'workflow-generation' },
  }) as { taskId?: string; error?: unknown };
  const taskId = submitted?.taskId;
  if (!taskId) {
    const message = submitted?.error && typeof submitted.error === 'object' && 'message' in submitted.error
      ? String((submitted.error as { message?: unknown }).message)
      : 'Runtime 未返回任务 ID';
    throw new Error(`提交失败：${message}`);
  }
  let task: RuntimeTaskView;
  try {
    task = await pollRuntimeTask(runtime, taskId, params.onProgress, params.signal);
  } catch (error) {
    // 用户停止：除了不再轮询，还要让 Runtime 取消上游任务，否则它会继续跑并计费。取消失败不能掩盖原始的 abort。
    if (params.signal?.aborted) {
      await runtime.execute({
        protocolVersion: '1',
        commandId: crypto.randomUUID(),
        command: 'task.cancel',
        // Runtime 端 task.cancel 强制要求 idempotencyKey；同一任务重复停止只产生一次取消请求。
        idempotencyKey: 'cancel:' + taskId,
        args: { taskId, reason: 'user_abort' },
        actor: { kind: 'ui', instanceId: 'workflow-generation' },
      }).catch(cancelError => console.warn('[Runtime] task.cancel failed', { taskId, cancelError }));
    }
    throw error;
  }
  if (task.status !== 'completed' && task.status !== 'succeeded') {
    throw new Error(`Runtime 生成失败：${JSON.stringify(task?.error)}`);
  }
  const blob = await loadRuntimeArtifactBlob(taskId, task.result?.artifact?.mimeType);
  return { blob, mimeType: blob.type, taskId, priceQuote: task.result?.priceQuote };
}

export function isGenerationCommand(value: string): value is GenerationCommand {
  return (GENERATION_COMMANDS as readonly string[]).includes(value);
}
