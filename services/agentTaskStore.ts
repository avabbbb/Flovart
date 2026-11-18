// 内置 Agent 后台任务的浏览器台账（IndexedDB，经 localforage，与用量台账一样用独立数据库，
// 打开它不会阻塞画布 / 媒体库的升级）。每个任务一条记录，键为 `<projectId>::<taskId>`，
// 每个项目的任务层只读写自己项目前缀下的记录。
import localforage from 'localforage';

export interface AgentTaskLedgerStore {
  load(): Promise<Record<string, unknown>[]>;
  put(record: Record<string, unknown> & { taskId: string }): Promise<void>;
  remove(taskId: string): Promise<void>;
}

const SEPARATOR = '::';
let instance: LocalForage | null = null;

function ledger(): LocalForage {
  if (!instance) instance = localforage.createInstance({ name: 'flovart_agent_tasks_v1', storeName: 'tasks' });
  return instance;
}

export function createBrowserAgentTaskStore(projectId: string, database: LocalForage = ledger()): AgentTaskLedgerStore {
  const prefix = projectId + SEPARATOR;
  return {
    async load() {
      const records: Record<string, unknown>[] = [];
      await database.iterate<Record<string, unknown>, void>((value, key) => {
        if (key.startsWith(prefix) && value && typeof value === 'object') records.push(value);
      });
      return records;
    },
    async put(record) {
      await database.setItem(prefix + record.taskId, record);
    },
    async remove(taskId) {
      await database.removeItem(prefix + taskId);
    },
  };
}

/** 测试用：清空浏览器任务台账。 */
export async function clearBrowserAgentTaskLedger(): Promise<void> {
  await ledger().clear();
}
