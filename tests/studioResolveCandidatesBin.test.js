import { describe, expect, it } from 'vitest';
import { CANDIDATES_BIN_NAME, findOrCreateCandidatesBin, withCandidatesBin } from '../integrations/studio/resolve/candidates-bin.js';

function folder(name) { return { GetName: () => name }; }

function mediaPoolFake({ existing = [], addFails = false, setFails = false } = {}) {
  const root = folder('Master');
  const subs = existing.map(folder);
  const calls = [];
  let current = folder('User Bin');
  const pool = {
    GetRootFolder: () => root,
    GetCurrentFolder: () => current,
    SetCurrentFolder: f => { calls.push(['set', f.GetName()]); if (setFails) return false; current = f; return true; },
    AddSubFolder: (parent, name) => { calls.push(['add', name]); if (addFails) return null; const f = folder(name); subs.push(f); return f; },
    ImportMedia: paths => { calls.push(['import', current.GetName(), paths[0]]); return [{ GetUniqueId: () => 'item-1' }]; },
  };
  root.GetSubFolderList = () => subs;
  return { pool, calls, current: () => current };
}

describe('Resolve Iris Candidates bin', () => {
  it('reuses an existing bin instead of creating a duplicate', async () => {
    const { pool, calls } = mediaPoolFake({ existing: ['B-roll', CANDIDATES_BIN_NAME] });
    const bin = await findOrCreateCandidatesBin(pool);
    expect(bin.GetName()).toBe(CANDIDATES_BIN_NAME);
    expect(calls.some(([op]) => op === 'add')).toBe(false);
  });

  it('imports into the bin and restores the user folder afterwards', async () => {
    const { pool, calls, current } = mediaPoolFake();
    const { result, bin } = await withCandidatesBin(pool, () => pool.ImportMedia(['/tmp/a.png']));
    expect(bin).toBe(CANDIDATES_BIN_NAME);
    expect(result).toHaveLength(1);
    expect(calls).toContainEqual(['import', CANDIDATES_BIN_NAME, '/tmp/a.png']);
    expect(current().GetName()).toBe('User Bin');
  });

  it('falls back to the current folder when the bin cannot be created', async () => {
    const { pool, calls } = mediaPoolFake({ addFails: true });
    const { bin } = await withCandidatesBin(pool, () => pool.ImportMedia(['/tmp/a.png']));
    expect(bin).toBeNull();
    expect(calls).toContainEqual(['import', 'User Bin', '/tmp/a.png']);
  });

  it('reports no bin when Resolve refuses to switch folders', async () => {
    const { pool } = mediaPoolFake({ setFails: true });
    const { bin } = await withCandidatesBin(pool, () => pool.ImportMedia(['/tmp/a.png']));
    expect(bin).toBeNull();
  });
});
