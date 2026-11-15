import { COMMAND_REGISTRY } from './core.js';

// 旧命令名保留给现有脚本，但不再走 file-state 影子：直接转到 Runtime / Workspace 的等价命令。
export function legacyForward(command, args = {}) {
  if (command === 'video.status') {
    const taskId = args.taskId ?? args['task-id'] ?? args.jobId ?? args['job-id'];
    return { command: 'task.get', args: { ...args, taskId } };
  }
  if (command === 'export.project') {
    return { command: 'workflow.inspect', args };
  }
  return null;
}

/** generate.images-batch → 每项一次 Runtime generate.image，幂等键按序派生，重试只补缺的那张。 */
export function imagesBatchInvocations(args = {}) {
  let items = args.items ?? args.itemsJson ?? args['items-json'];
  if (typeof items === 'string') items = JSON.parse(items);
  if (!Array.isArray(items) || items.length === 0) throw new Error('generate.images-batch 需要非空 items 数组');
  const key = args.idempotencyKey || args['idempotency-key'];
  if (!key) throw new Error('generate.images-batch requires --idempotency-key so retries cannot duplicate work.');
  return items.map((item, index) => {
    const entry = typeof item === 'string' ? { prompt: item } : { ...item };
    if (!entry.prompt) throw new Error(`items[${index}].prompt 必填`);
    const allowed = Object.keys(COMMAND_REGISTRY['generate.image']?.args || {});
    const commandArgs = Object.fromEntries(Object.entries(entry).filter(([name]) => allowed.includes(name)));
    return { commandArgs, options: { idempotencyKey: `${key}:${index}` } };
  });
}

// 旧浏览器 Bridge 文件队列已删除；Workflow 节点运行/停止现在只通过
// Workspace Adapter 转发到浏览器 Authority 的唯一 WorkflowExecutor。
