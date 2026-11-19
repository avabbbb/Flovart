// CLI 管道友好输出（libtv-docs-study D.4-2）：
// stdout 每条结果只占一行 JSON（NDJSON），进度与提示走 stderr 并带 "[iris]" 前缀；
// 下游命令可以用 `--references -` / `--node-ids -` 从 stdin 读上游结果里的 nodeId。

export const CLI_PROGRESS_PREFIX = '[iris]';

/** 一条 CLI 结果：默认单行 JSON；pretty=true（--pretty）时缩进，方便人读。 */
export function formatCliResponse(payload, { pretty = false } = {}) {
  return pretty ? JSON.stringify(payload, null, 2) : JSON.stringify(payload);
}

/** 进度行写到 stderr，不污染 stdout 的 NDJSON。 */
export function cliProgress(message, stream = process.stderr) {
  stream.write(CLI_PROGRESS_PREFIX + ' ' + String(message).replace(/\s*\n\s*/g, ' ') + '\n');
}

function collect(value, out, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return;
  if (Array.isArray(value)) {
    for (const item of value) collect(item, out, depth + 1);
    return;
  }
  if (value.ok === false) return;
  if (typeof value.nodeId === 'string' && value.nodeId) out.push(value.nodeId);
  for (const key of ['outputNodeIds', 'nodeIds', 'memberNodeIds']) {
    if (Array.isArray(value[key])) for (const id of value[key]) if (typeof id === 'string' && id) out.push(id);
  }
  for (const key of ['data', 'result', 'runs', 'files', 'batch']) collect(value[key], out, depth + 1);
}

/**
 * 从上游 stdout 取 nodeId：每行一条 JSON（取 data/result 里的 nodeId、outputNodeIds、nodeIds、runs[].nodeId…），
 * 失败的结果（ok=false）跳过；不是 JSON 的非空行按逗号/空白拆成裸 id。保持出现顺序并去重。
 */
export function nodeIdsFromNdjson(text) {
  const ids = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('{') || line.startsWith('[')) {
      try {
        collect(JSON.parse(line), ids);
        continue;
      } catch { /* 不是完整 JSON，按裸 id 处理 */ }
    }
    for (const token of line.split(/[\s,]+/)) if (/^[\w:.-]+$/.test(token)) ids.push(token);
  }
  return [...new Set(ids)];
}

export async function readStdinText(stream = process.stdin) {
  if (stream.isTTY) return '';
  let text = '';
  stream.setEncoding?.('utf8');
  for await (const chunk of stream) text += chunk;
  return text;
}

/**
 * `--references -`（workflow.generate）与 `--node-ids -`（workflow.node.run / focus / export）从 stdin 取 id。
 * 返回替换后的 args；没有 "-" 时原样返回。
 */
export async function applyStdinNodeIds(command, args, readText = readStdinText) {
  const wantsReferences = command === 'workflow.generate' && args.references === '-';
  const nodeIdsKey = args.nodeIds === '-' ? 'nodeIds' : args['node-ids'] === '-' ? 'node-ids' : null;
  if (!wantsReferences && !nodeIdsKey) return args;
  const ids = nodeIdsFromNdjson(await readText());
  if (!ids.length) throw Object.assign(new Error('stdin 里没有读到 nodeId（上游命令需要输出成功的 JSON 结果或裸 id）'), { code: 'INVALID_ARGUMENT' });
  const next = { ...args };
  if (wantsReferences) next.references = JSON.stringify(ids.map(nodeId => ({ nodeId })));
  if (nodeIdsKey) next[nodeIdsKey] = ids.join(',');
  return next;
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

/**
 * `agent.task.start --wait`：轮询 get 直到结束，事件逐条写 stderr；返回最后一次 get 的结果。
 * getTask(taskId, afterSeq) 返回命令结果（{ ok, result } 或任务视图本身）。
 */
export async function waitForAgentTask(taskId, getTask, { intervalMs = 2000, timeoutMs = 60 * 60_000, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), progress = cliProgress, now = () => Date.now() } = {}) {
  const deadline = now() + timeoutMs;
  let afterSeq = 0;
  for (;;) {
    const response = await getTask(taskId, afterSeq);
    if (response && response.ok === false) return response;
    const view = response?.result ?? response;
    for (const event of view?.events || []) {
      progress('task ' + taskId + ' #' + event.seq + ' ' + event.type + (event.error?.message ? '：' + event.error.message : ''));
    }
    afterSeq = Math.max(afterSeq, Number(view?.seq) || 0);
    if (TERMINAL.has(view?.status)) return response;
    if (now() >= deadline) {
      return { ok: false, error: { code: 'WAIT_TIMEOUT', message: '等待任务超时；任务仍在后台运行，可继续用 agent.task.get 查询', details: { taskId } } };
    }
    await sleep(intervalMs);
  }
}
