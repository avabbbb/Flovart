import { getFlovartRuntimeApi } from './flovartRuntime';
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

const TASK_TERMINAL = new Set(['completed', 'succeeded', 'failed', 'cancelled', 'cancelled', 'error']);

async function pollRuntimeTask(runtime: NonNullable<ReturnType<typeof getFlovartRuntimeApi>>, taskId: string, onProgress?: (message: string) => void, signal?: AbortSignal): Promise<RuntimeTaskView> {
  for (;;) {
    if (signal?.aborted) throw new Error('已取消');
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
    await new Promise(resolve => setTimeout(resolve, 2000));
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
  const task = await pollRuntimeTask(runtime, taskId, params.onProgress, params.signal);
  if (task.status !== 'completed' && task.status !== 'succeeded') {
    throw new Error(`Runtime 生成失败：${JSON.stringify(task?.error)}`);
  }
  const blob = await loadRuntimeArtifactBlob(taskId, task.result?.artifact?.mimeType);
  return { blob, mimeType: blob.type, taskId, priceQuote: task.result?.priceQuote };
}

export function isGenerationCommand(value: string): value is GenerationCommand {
  return (GENERATION_COMMANDS as readonly string[]).includes(value);
}
