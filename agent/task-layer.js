// 异步任务层（libtv-vs-flovart-agent-tools §G：task_start / get(afterSeq) / cancel）。
// 外部 Agent 的长命令（agent.turn、生成、导出…）在本机 Agent 会话里后台执行：
// start 立即返回 taskId，get 轮询状态与增量事件，cancel 协作式取消。
// 不受单次请求 60 秒超时限制；任务只在本机 Agent 进程内存中保留（进程重启即丢失，get 返回 NOT_FOUND）。

export const AGENT_TASK_COMMANDS = Object.freeze(['agent.task.start', 'agent.task.get', 'agent.task.cancel']);
export const AGENT_TASK_COMMAND_SET = new Set(AGENT_TASK_COMMANDS);

/** 可以作为后台任务启动的命令（都是可能超过 60 秒的命令）。 */
export const TASKABLE_COMMANDS = Object.freeze([
  'agent.turn',
  'workflow.node.run',
  'workflow.generate',
  'workflow.node.tool',
  'workflow.media.import',
  'workflow.export',
]);
const TASKABLE_COMMAND_SET = new Set(TASKABLE_COMMANDS);

export const AGENT_TASK_TERMINAL_STATES = Object.freeze(['succeeded', 'failed', 'cancelled']);
const TERMINAL = new Set(AGENT_TASK_TERMINAL_STATES);

const DEFAULT_TASK_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_RETENTION_MS = 6 * 60 * 60_000;
const DEFAULT_MAX_TASKS = 200;
const MAX_EVENTS = 200;

export class AgentTaskError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AgentTaskError';
    this.code = code;
    this.details = details;
  }
}

function plainError(error) {
  if (!error) return { code: 'TASK_FAILED', message: '任务失败' };
  if (typeof error === 'string') return { code: 'TASK_FAILED', message: error };
  return {
    code: String(error.code || 'TASK_FAILED'),
    message: String(error.message || '任务失败'),
    ...(error.details && typeof error.details === 'object' ? { details: error.details } : {}),
  };
}

function nodeIdsOf(command, args = {}) {
  if (command !== 'workflow.node.run' && command !== 'workflow.generate') return [];
  const ids = [];
  if (typeof args.nodeId === 'string' && args.nodeId) ids.push(args.nodeId);
  const list = Array.isArray(args.nodeIds) ? args.nodeIds : typeof args.nodeIds === 'string' ? args.nodeIds.split(',') : [];
  for (const id of list) if (String(id).trim()) ids.push(String(id).trim());
  return [...new Set(ids)];
}

/**
 * @param {object} options
 * @param {(command: string, args: object, source: string, idempotencyKey: string|undefined, signal: AbortSignal, caller: object|undefined, runOptions: {timeoutMs: number}) => Promise<any>} options.run
 * @param {(command: string, args: object, source: string, caller: object|undefined) => Promise<any>} [options.stop] 取消时尽力停止画布上的生成节点
 */
export function createAgentTaskLayer({
  run,
  stop,
  now = () => Date.now(),
  createId = () => 'atask_' + crypto.randomUUID(),
  taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
  retentionMs = DEFAULT_RETENTION_MS,
  maxTasks = DEFAULT_MAX_TASKS,
  onEvent,
} = {}) {
  if (typeof run !== 'function') throw new TypeError('createAgentTaskLayer requires run');
  const tasks = new Map();
  const byKey = new Map();

  const iso = () => new Date(now()).toISOString();

  function push(task, type, extra = {}) {
    task.seq += 1;
    const event = { seq: task.seq, at: iso(), type, ...extra };
    task.events.push(event);
    if (task.events.length > MAX_EVENTS) task.events.splice(0, task.events.length - MAX_EVENTS);
    task.updatedAt = event.at;
    onEvent?.(task.taskId, event);
    return event;
  }

  function prune() {
    const cutoff = now() - retentionMs;
    for (const [taskId, task] of tasks) {
      if (TERMINAL.has(task.status) && Date.parse(task.updatedAt) < cutoff) forget(taskId);
    }
    if (tasks.size < maxTasks) return;
    for (const [taskId, task] of tasks) {
      if (tasks.size < maxTasks) break;
      if (TERMINAL.has(task.status)) forget(taskId);
    }
    if (tasks.size >= maxTasks) throw new AgentTaskError('TASK_LIMIT', '同时保留的任务已达上限 ' + maxTasks + '，请先等待或取消已有任务。');
  }

  function forget(taskId) {
    const task = tasks.get(taskId);
    if (!task) return;
    tasks.delete(taskId);
    if (task.dedupeKey && byKey.get(task.dedupeKey) === taskId) byKey.delete(task.dedupeKey);
  }

  function view(task, afterSeq = 0) {
    const events = task.events.filter(event => event.seq > afterSeq);
    return {
      taskId: task.taskId,
      command: task.command,
      status: task.status,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      ...(task.startedAt ? { startedAt: task.startedAt } : {}),
      ...(task.finishedAt ? { finishedAt: task.finishedAt } : {}),
      seq: task.seq,
      events,
      done: TERMINAL.has(task.status),
      ...(task.status === 'succeeded' ? { result: task.result } : {}),
      ...(task.error ? { error: task.error } : {}),
      ...(task.cancelRequested && !TERMINAL.has(task.status) ? { cancelRequested: true } : {}),
      ...(task.nodeIds.length ? { nodeIds: task.nodeIds } : {}),
    };
  }

  function finish(task, status, payload) {
    if (TERMINAL.has(task.status)) return;
    task.status = status;
    task.finishedAt = iso();
    if (status === 'succeeded') task.result = payload;
    else task.error = payload;
    push(task, status, status === 'succeeded' ? {} : { error: payload });
  }

  async function execute(task, { source, caller, idempotencyKey }) {
    if (TERMINAL.has(task.status)) return;
    task.status = 'running';
    task.startedAt = iso();
    push(task, 'started');
    let response;
    try {
      response = await run(task.command, task.args, source, idempotencyKey, task.controller.signal, caller, { timeoutMs: taskTimeoutMs });
    } catch (error) {
      if (task.cancelRequested) finish(task, 'cancelled', { code: 'TASK_CANCELLED', message: task.cancelReason || '任务已取消' });
      else finish(task, 'failed', plainError(error));
      return;
    }
    if (task.cancelRequested) {
      // 取消后才回来的结果不再当作成功交付，但记下来便于排查（生成可能已经扣费）。
      finish(task, 'cancelled', { code: 'TASK_CANCELLED', message: task.cancelReason || '任务已取消', lateResult: true });
      return;
    }
    if (response && typeof response === 'object' && response.ok === false) {
      finish(task, 'failed', plainError(response.error));
      return;
    }
    if (response?.confirmation?.required) {
      finish(task, 'failed', { code: 'CONFIRMATION_REQUIRED', message: response.confirmation.summary || '需要用户在画布上确认后才能执行。' });
      return;
    }
    finish(task, 'succeeded', response && typeof response === 'object' && 'result' in response ? response.result : response);
  }

  function start({ command, args = {}, idempotencyKey, source = 'agent', caller } = {}) {
    const target = String(command || '').trim();
    if (!TASKABLE_COMMAND_SET.has(target)) {
      throw new AgentTaskError('INVALID_ARGUMENT', '不能作为后台任务启动的命令：' + (target || '(空)') + '。可用：' + TASKABLE_COMMANDS.join('、'), { taskable: TASKABLE_COMMANDS });
    }
    if (args === null || typeof args !== 'object' || Array.isArray(args)) throw new AgentTaskError('INVALID_ARGUMENT', 'args 必须是对象');
    const key = String(idempotencyKey || '').trim();
    const dedupeKey = key ? [caller?.agentIdentity || source, target, key].join('\u0000') : '';
    if (dedupeKey && byKey.has(dedupeKey) && tasks.has(byKey.get(dedupeKey))) {
      return { ...view(tasks.get(byKey.get(dedupeKey))), replayed: true };
    }
    prune();
    const createdAt = iso();
    const task = {
      taskId: createId(),
      command: target,
      args: { ...args },
      status: 'queued',
      createdAt,
      updatedAt: createdAt,
      seq: 0,
      events: [],
      nodeIds: nodeIdsOf(target, args),
      controller: new AbortController(),
      cancelRequested: false,
      dedupeKey,
      owner: caller?.agentIdentity || null,
    };
    tasks.set(task.taskId, task);
    if (dedupeKey) byKey.set(dedupeKey, task.taskId);
    push(task, 'queued');
    // 子命令的幂等键从任务键派生：任务重放不会重复提交生成。
    const childKey = key ? 'task:' + key : task.taskId;
    task.promise = Promise.resolve().then(() => execute(task, { source, caller, idempotencyKey: childKey }));
    return view(task);
  }

  function lookup(taskId) {
    const task = tasks.get(String(taskId || ''));
    if (!task) throw new AgentTaskError('NOT_FOUND', '任务不存在或已过期：' + String(taskId || '(空)') + '（任务只保存在本机 Agent 进程里，重启后会清空）');
    return task;
  }

  function get({ taskId, afterSeq } = {}) {
    const task = lookup(taskId);
    const after = Number.isFinite(Number(afterSeq)) ? Math.max(0, Number(afterSeq)) : 0;
    return view(task, after);
  }

  async function cancel({ taskId, reason, source = 'agent', caller } = {}) {
    const task = lookup(taskId);
    if (TERMINAL.has(task.status)) return { ...view(task), alreadyFinished: true };
    task.cancelRequested = true;
    task.cancelReason = typeof reason === 'string' && reason.trim() ? reason.trim() : '任务已取消';
    push(task, 'cancel_requested', { reason: task.cancelReason });
    const stopped = [];
    if (stop && task.nodeIds.length) {
      for (const nodeId of task.nodeIds) {
        try {
          const response = await stop('workflow.node.stop', { nodeId, ...(task.args.projectId ? { projectId: task.args.projectId } : {}) }, source, caller);
          if (!(response && response.ok === false)) stopped.push(nodeId);
        } catch { /* 节点可能已结束；以任务状态为准 */ }
      }
    }
    task.controller.abort();
    // abort 会让等待中的会话请求立即以 CANCELLED 结束；这里不等它，直接给出当前视图。
    if (!TERMINAL.has(task.status) && task.status === 'queued') finish(task, 'cancelled', { code: 'TASK_CANCELLED', message: task.cancelReason });
    return { ...view(task), ...(stopped.length ? { stoppedNodeIds: stopped } : {}) };
  }

  function list() {
    return [...tasks.values()].map(task => ({ taskId: task.taskId, command: task.command, status: task.status, createdAt: task.createdAt, updatedAt: task.updatedAt }));
  }

  /** 测试用：等待某个任务的执行 promise 结束。 */
  function settled(taskId) {
    return tasks.get(taskId)?.promise ?? Promise.resolve();
  }

  /** 会话命令入口：返回 { ok, result } / { ok:false, error }。 */
  async function handle(command, args = {}, { source = 'agent', idempotencyKey, caller } = {}) {
    try {
      if (command === 'agent.task.start') {
        const childArgs = args.args === undefined ? {} : typeof args.args === 'string' ? JSON.parse(args.args) : args.args;
        return { ok: true, result: start({ command: args.command, args: childArgs, idempotencyKey: idempotencyKey || args.idempotencyKey, source, caller }) };
      }
      if (command === 'agent.task.get') return { ok: true, result: get(args) };
      if (command === 'agent.task.cancel') return { ok: true, result: await cancel({ ...args, source, caller }) };
      return { ok: false, error: { code: 'UNKNOWN_COMMAND', message: '未知任务命令：' + command } };
    } catch (error) {
      if (error instanceof SyntaxError) return { ok: false, error: { code: 'INVALID_ARGUMENT', message: 'args 不是合法 JSON：' + error.message } };
      return { ok: false, error: plainError(error) };
    }
  }

  return { start, get, cancel, list, settled, handle };
}
