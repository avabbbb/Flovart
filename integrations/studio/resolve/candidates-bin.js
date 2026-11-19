// Resolves (or creates) the "Iris Candidates" bin under the Media Pool root so
// every imported candidate lands in one predictable place. It never deletes or
// renames user bins, and always restores the user's previously open bin.

const CANDIDATES_BIN_NAME = 'Iris Candidates';

const call = async (target, method, ...args) => {
  const fn = target?.[method];
  if (typeof fn !== 'function') return undefined;
  return fn.apply(target, args);
};

async function folderName(folder) {
  try { return String((await call(folder, 'GetName')) || '').trim(); } catch { return ''; }
}

async function findOrCreateCandidatesBin(mediaPool, name = CANDIDATES_BIN_NAME) {
  const root = await call(mediaPool, 'GetRootFolder');
  if (!root) return null;
  const subfolders = (await call(root, 'GetSubFolderList')) || [];
  for (const folder of Array.isArray(subfolders) ? subfolders : Object.values(subfolders)) {
    if (await folderName(folder) === name) return folder;
  }
  return (await call(mediaPool, 'AddSubFolder', root, name)) || null;
}

/**
 * Runs `importFn` with the Candidates bin as the current Media Pool folder.
 * Falls back to the current folder when the bin cannot be resolved, and
 * reports which one was used so callers can surface it honestly.
 */
async function withCandidatesBin(mediaPool, importFn) {
  let previous = null;
  let bin = null;
  try {
    previous = await call(mediaPool, 'GetCurrentFolder');
    bin = await findOrCreateCandidatesBin(mediaPool);
    if (bin && !(await call(mediaPool, 'SetCurrentFolder', bin))) bin = null;
  } catch {
    bin = null;
  }
  try {
    const result = await importFn();
    return { result, bin: bin ? CANDIDATES_BIN_NAME : null };
  } finally {
    if (bin && previous) {
      try { await call(mediaPool, 'SetCurrentFolder', previous); } catch {}
    }
  }
}

module.exports = { CANDIDATES_BIN_NAME, findOrCreateCandidatesBin, withCandidatesBin };
