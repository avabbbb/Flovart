import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { AGENT_DIR } from './config.js';

// 本机 Agent 的任务台账：Agent 数据目录（~/.flovart，与 agent.json 同目录）下的 agent-tasks.json。
// 记录量小（保留上限 200 条），整文件写临时文件再 rename 原子替换；写入串行。
// 文件损坏时备份为 *.corrupt 后从空台账开始，不让 Agent 启动失败。

export const AGENT_TASK_LEDGER_FILE = 'agent-tasks.json';

export function createFileTaskStore({ file = path.join(AGENT_DIR, AGENT_TASK_LEDGER_FILE) } = {}) {
  let records = null;
  let chain = Promise.resolve();

  async function read() {
    if (records) return records;
    records = new Map();
    let text;
    try {
      text = await fsp.readFile(file, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return records;
      throw error;
    }
    try {
      const document = JSON.parse(text);
      for (const record of Array.isArray(document?.tasks) ? document.tasks : []) {
        if (record && typeof record === 'object' && record.taskId) records.set(String(record.taskId), record);
      }
    } catch (error) {
      try { await fsp.rename(file, file + '.' + Date.now() + '.corrupt'); } catch { /* best effort */ }
      console.error('[flovart-agent] 任务台账损坏，已备份并从空台账开始：' + (error?.message || error));
    }
    return records;
  }

  async function write() {
    const dir = path.dirname(file);
    const temp = path.join(dir, '.' + path.basename(file) + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp');
    await fsp.mkdir(dir, { recursive: true });
    try {
      await fsp.writeFile(temp, JSON.stringify({ version: 1, tasks: [...records.values()] }), 'utf8');
      try {
        if (process.platform !== 'win32') await fsp.chmod(temp, 0o600);
      } catch { /* 权限加固失败不阻断写盘 */ }
      await fsp.rename(temp, file);
    } catch (error) {
      try { await fsp.rm(temp, { force: true }); } catch { /* best effort */ }
      throw error;
    }
  }

  const enqueue = step => {
    const next = chain.then(step);
    chain = next.catch(() => {});
    return next;
  };

  return {
    file,
    load: () => enqueue(async () => [...(await read()).values()].map(record => structuredClone(record))),
    put: record => enqueue(async () => {
      (await read()).set(String(record.taskId), structuredClone(record));
      await write();
    }),
    remove: taskId => enqueue(async () => {
      const map = await read();
      if (!map.delete(String(taskId))) return;
      await write();
    }),
  };
}
