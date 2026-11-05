// 画布 Vault → 已配对的浏览器插件。
// 连接进入 approved 后先发 keys.snapshot（全量），之后每次 Key 变更只发 keys.delta（增量）。
// 插件拒绝 delta（revision 对不上）时回退为全量；任何失败都在下次变更或重连时整份重发。

export interface ExtensionKeySource {
  id: string;
  provider: string;
  key: string;
  baseUrl?: string;
  capabilities?: readonly string[];
  defaultModel?: string;
}

export interface ExtensionKeyEntry {
  id: string;
  provider: string;
  key: string;
  baseUrl?: string;
  capabilities?: string[];
  defaultModel?: string;
}

export interface KeySyncBridge {
  getState(): { status: string };
  subscribe(listener: (state: { status: string }) => void): () => void;
  request(type: string, payload: Record<string, unknown>): Promise<unknown>;
}

export interface ExtensionKeySync {
  update(keys: readonly ExtensionKeySource[]): Promise<void>;
  dispose(): void;
}

const REVISION_MISMATCH = 'keys.revision-mismatch';

// 只发插件用得到的字段；字段顺序固定，便于用 JSON 字符串比较是否变化。
export function toExtensionKeyEntry(source: ExtensionKeySource): ExtensionKeyEntry {
  const entry: ExtensionKeyEntry = { id: source.id, provider: source.provider, key: source.key };
  if (source.baseUrl) entry.baseUrl = source.baseUrl;
  if (source.capabilities?.length) entry.capabilities = [...source.capabilities];
  if (source.defaultModel) entry.defaultModel = source.defaultModel;
  return entry;
}

export function diffExtensionKeys(previous: readonly ExtensionKeyEntry[], next: readonly ExtensionKeyEntry[]) {
  const before = new Map(previous.map(entry => [entry.id, JSON.stringify(entry)]));
  const nextIds = new Set(next.map(entry => entry.id));
  return {
    upsert: next.filter(entry => before.get(entry.id) !== JSON.stringify(entry)),
    remove: previous.filter(entry => !nextIds.has(entry.id)).map(entry => entry.id),
  };
}

function isRevisionMismatch(error: unknown): boolean {
  return error instanceof Error && error.message.includes(REVISION_MISMATCH);
}

export function createExtensionKeySync(bridge: KeySyncBridge): ExtensionKeySync {
  let desired: ExtensionKeyEntry[] = [];
  let hasDesired = false;
  let acked: { revision: number; keys: ExtensionKeyEntry[] } | null = null;
  let running: Promise<void> | null = null;
  let dirty = false;
  let disposed = false;
  let wasApproved = bridge.getState().status === 'approved';

  async function drain() {
    do {
      dirty = false;
      if (disposed || !hasDesired || bridge.getState().status !== 'approved') return;
      const target = desired;
      const revision = (acked?.revision ?? 0) + 1;
      if (acked) {
        const { upsert, remove } = diffExtensionKeys(acked.keys, target);
        if (!upsert.length && !remove.length) continue;
        try {
          await bridge.request('keys.delta', { baseRevision: acked.revision, revision, upsert, remove });
          acked = { revision, keys: target };
          continue;
        } catch (error) {
          if (!isRevisionMismatch(error)) throw error;
        }
      }
      await bridge.request('keys.snapshot', { revision, keys: target });
      acked = { revision, keys: target };
    } while (dirty);
  }

  function flush(): Promise<void> {
    if (running) {
      dirty = true;
      return running;
    }
    running = drain()
      .catch(() => {
        acked = null;
      })
      .finally(() => {
        running = null;
      });
    return running;
  }

  const unsubscribe = bridge.subscribe(state => {
    const approved = state.status === 'approved';
    // 每次重新进入 approved 都从全量开始：插件可能在断线期间被撤销并清空过。
    if (!approved || !wasApproved) acked = null;
    if (approved && !wasApproved) void flush();
    wasApproved = approved;
  });

  return {
    update(keys) {
      desired = keys.map(toExtensionKeyEntry);
      hasDesired = true;
      return flush();
    },
    dispose() {
      disposed = true;
      unsubscribe();
    },
  };
}
