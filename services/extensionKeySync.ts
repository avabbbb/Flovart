// 画布 Vault → 已配对的浏览器插件。
// 连接进入 approved 后先发 keys.snapshot（全量），之后每次 Key 变更只发 keys.delta（增量）。
// 插件拒绝 delta（revision 对不上）时回退为全量；发送失败时若期间又有变更则立即全量重试一次，否则在下次变更或重连时整份重发。

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

// idle：没有进行中的发送；draining：正在把 desired 推给插件；disposed：终态，忽略一切更新。
type KeySyncPhase = 'idle' | 'draining' | 'disposed';

export function createExtensionKeySync(bridge: KeySyncBridge): ExtensionKeySync {
  let desired: ExtensionKeyEntry[] = [];
  let hasDesired = false;
  let acked: { revision: number; keys: ExtensionKeyEntry[] } | null = null;
  let phase: KeySyncPhase = 'idle';
  let running: Promise<void> | null = null;
  // draining 期间又有变更：本轮结束后再推一次。
  let dirty = false;
  let wasApproved = bridge.getState().status === 'approved';

  async function drain() {
    do {
      dirty = false;
      if (phase === 'disposed' || !hasDesired || bridge.getState().status !== 'approved') return;
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

  async function drainWithRetry() {
    let retried = false;
    for (;;) {
      try {
        await drain();
        return;
      } catch (error) {
        acked = null;
        const willRetry = dirty && !retried;
        console.warn('[ExtensionKeySync] 同步 Key 到插件失败', { error: error instanceof Error ? error.message : String(error), willRetry });
        // 失败那一轮里又有新变更：立即用全量重试一次，否则最新 Key 要等下次变更或重连才送达。
        if (!willRetry) return;
        retried = true;
      }
    }
  }

  function flush(): Promise<void> {
    if (phase === 'disposed') return Promise.resolve();
    if (phase === 'draining' && running) {
      dirty = true;
      return running;
    }
    phase = 'draining';
    running = drainWithRetry().finally(() => {
      running = null;
      if (phase === 'draining') phase = 'idle';
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
      phase = 'disposed';
      unsubscribe();
    },
  };
}
