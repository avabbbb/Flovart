// 网页画布配对状态：background 与 popup 共用。
// 结构：{ [origin]: { status: 'pending' | 'approved', updatedAt } }。拒绝或撤销直接删除条目，
// 这样用户之后还能重新发起配对，不会被一次误点永久锁死。
export const PAIRINGS_KEY = 'flovartWebPairings';

let writeChain = Promise.resolve();

function storageOf(storage) {
  const resolved = storage || globalThis.chrome?.storage?.local;
  if (!resolved) throw new Error('chrome.storage.local 不可用');
  return resolved;
}

export async function readPairings(storage) {
  const stored = await storageOf(storage).get(PAIRINGS_KEY);
  const value = stored?.[PAIRINGS_KEY];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

// 读-改-写串行化，避免 popup 批准与新的配对请求互相覆盖。
function mutatePairings(storage, mutate) {
  const target = storageOf(storage);
  const run = writeChain.then(async () => {
    const pairings = await readPairings(target);
    mutate(pairings);
    await target.set({ [PAIRINGS_KEY]: pairings });
    return pairings;
  });
  writeChain = run.catch(() => {});
  return run;
}

export function setPairingStatus(origin, status, storage) {
  if (status !== 'pending' && status !== 'approved') throw new Error('未知配对状态：' + status);
  return mutatePairings(storage, pairings => {
    pairings[origin] = { status, updatedAt: Date.now() };
  });
}

export function removePairing(origin, storage) {
  return mutatePairings(storage, pairings => {
    delete pairings[origin];
  });
}

// 把存储变化翻译成发给网页的结果：pending→删除 是拒绝，approved→删除 是撤销。
export function pairingTransition(oldStatus, newStatus) {
  if (newStatus === 'approved' || newStatus === 'pending') return newStatus;
  return oldStatus === 'approved' ? 'revoked' : 'rejected';
}
