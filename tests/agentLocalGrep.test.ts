import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectoryHandleLike, FileHandleLike } from '../services/localFolderSource';

type FakeTree = { [name: string]: string | FakeTree };
const folders = new Map<string, { name: string; root: DirectoryHandleLike; permission: 'granted' | 'prompt' }>();

vi.mock('../services/localFolderSource', () => ({
  listLocalFolderSources: async () => [...folders.entries()].map(([id, folder], index) => ({
    id, name: folder.name, createdAt: String(index), persisted: true,
  })),
  getLocalFolderPermission: async (id: string) => folders.get(id)?.permission ?? 'missing',
  loadLocalFolderHandle: async (id: string) => folders.get(id)?.root ?? null,
}));

const { buildGrepMatcher, formatGrepMatches, grepLocalFolders, isTextFilePath, normalizeGrepPath } = await import('../services/agentLocalGrep');
type AgentGrepResult = import('../services/agentLocalGrep').AgentGrepResult;

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

/** 模拟 File System Access API：缺失 → NotFoundError，类型不符 → TypeMismatchError，stale → 读条目时 NotFoundError。 */
function fakeDirectory(name: string, tree: FakeTree, state = { stale: false }): DirectoryHandleLike {
  const child = (key: string): DirectoryHandleLike | FileHandleLike => {
    const value = tree[key];
    return typeof value === 'string' ? fakeFile(key, value) : fakeDirectory(key, value, state);
  };
  return {
    kind: 'directory',
    name,
    entries: async function* () {
      if (state.stale) throw domError('NotFoundError');
      for (const key of Object.keys(tree)) yield [key, child(key)] as [string, DirectoryHandleLike | FileHandleLike];
    } as unknown as DirectoryHandleLike['entries'],
    getDirectoryHandle: async (key: string) => {
      if (state.stale || !(key in tree)) throw domError('NotFoundError');
      if (typeof tree[key] === 'string') throw domError('TypeMismatchError');
      return child(key) as DirectoryHandleLike;
    },
    getFileHandle: async (key: string) => {
      if (state.stale || !(key in tree)) throw domError('NotFoundError');
      if (typeof tree[key] !== 'string') throw domError('TypeMismatchError');
      return child(key) as FileHandleLike;
    },
  };
}

function fakeFile(name: string, text: string): FileHandleLike {
  return { kind: 'file', name, getFile: async () => new File([text], name) };
}

describe('local grep', () => {
  it('treats only text-like paths as searchable', () => {
    expect(isTextFilePath('notes.md')).toBe(true);
    expect(isTextFilePath('shots.srt')).toBe(true);
    expect(isTextFilePath('prompt.JSON')).toBe(true);
    expect(isTextFilePath('clip.mp4')).toBe(false);
    expect(isTextFilePath('README')).toBe(false);
  });

  it('uses a regex, ignores case when asked, and falls back to a literal pattern', () => {
    expect(buildGrepMatcher('龙\\s+喷火', true)('龙 喷火')).toBe(true);
    expect(buildGrepMatcher('DRAGON', false)('a dragon flies')).toBe(true);
    expect(buildGrepMatcher('DRAGON', true)('a dragon flies')).toBe(false);
    expect(buildGrepMatcher('C++ (', true)('uses C++ (fast)')).toBe(true);
  });

  it('groups matches by file and notes truncation', () => {
    const result: AgentGrepResult = {
      matches: [
        { folderId: 'f1', folderName: '素材', path: 'refs/a.srt', line: 2, text: '龙 喷火' },
        { folderId: 'f1', folderName: '素材', path: 'refs/a.srt', line: 9, text: '龙 抬头' },
        { folderId: 'f1', folderName: '素材', path: 'notes.md', line: 1, text: '龙设定' },
      ],
      scannedFiles: 12,
      truncated: true,
      skippedFolders: [],
      missingFolders: false,
    };
    const text = formatGrepMatches(result);
    expect(text).toContain('[素材/refs/a.srt]\n*2|龙 喷火\n*9|龙 抬头');
    expect(text).toContain('[素材/notes.md]');
    expect(text).toContain('结果已截断');
  });

  it('explains when no folder is connected', () => {
    const text = formatGrepMatches({ matches: [], scannedFiles: 0, truncated: false, skippedFolders: [], missingFolders: true });
    expect(text).toContain('没有已连接的本地文件夹');
  });
});

describe('local grep scope semantics (OMP-aligned)', () => {
  beforeEach(() => folders.clear());

  it('normalizes ., ./ and trailing slashes to the folder root', () => {
    expect(normalizeGrepPath(undefined)).toEqual({ segments: [] });
    expect(normalizeGrepPath('.')).toEqual({ segments: [] });
    expect(normalizeGrepPath('./src/')).toEqual({ segments: ['src'] });
    expect(normalizeGrepPath('src\\docs')).toEqual({ segments: ['src', 'docs'] });
    expect('error' in normalizeGrepPath('../etc')).toBe(true);
  });

  it('errors instead of answering "no matches" when no folder is connected', async () => {
    const result = await grepLocalFolders({ pattern: 'alternates' });
    expect(result.error).toContain('没有已连接的本地文件夹');
    expect(formatGrepMatches(result)).toContain('没有已连接的本地文件夹');
  });

  it('reports a missing path as Path not found, not as an empty search', async () => {
    folders.set('f1', { name: 'Iris', root: fakeDirectory('Iris', { src: { 'a.ts': 'const alternates = [];' } }), permission: 'granted' });
    const missing = await grepLocalFolders({ pattern: 'alternates', path: 'components' });
    expect(missing.error).toContain('Path not found: components');
    expect(missing.error).toContain('Iris');

    const empty = await grepLocalFolders({ pattern: 'nothing-here', path: 'src' });
    expect(empty.error).toBeUndefined();
    expect(formatGrepMatches(empty)).toContain('没有匹配（已扫描 1 个文本文件）');
  });

  it('searches the root for omitted path and for "."', async () => {
    folders.set('f1', { name: 'Iris', root: fakeDirectory('Iris', { src: { 'a.ts': 'x\nconst alternates = [];' } }), permission: 'granted' });
    for (const path of [undefined, '.', './']) {
      const result = await grepLocalFolders({ pattern: 'alternates', path });
      expect(result.matches).toEqual([expect.objectContaining({ path: 'src/a.ts', line: 2 })]);
    }
  });

  it('accepts a single file, a folder-name prefix, and ;-lists with partial misses', async () => {
    folders.set('f1', { name: 'Iris', root: fakeDirectory('Iris', { src: { 'a.ts': 'alternates', 'b.ts': 'alternates' }, 'README': 'alternates' }), permission: 'granted' });
    expect((await grepLocalFolders({ pattern: 'alternates', path: 'src/a.ts' })).matches.map(m => m.path)).toEqual(['src/a.ts']);
    expect((await grepLocalFolders({ pattern: 'alternates', path: 'README' })).matches.map(m => m.path)).toEqual(['README']);
    expect((await grepLocalFolders({ pattern: 'alternates', path: 'Iris/src' })).matches).toHaveLength(2);
    const partial = await grepLocalFolders({ pattern: 'alternates', path: 'src; nope' });
    expect(partial.error).toBeUndefined();
    expect(partial.missingPaths).toEqual(['nope']);
    expect(formatGrepMatches(partial)).toContain('不存在，已跳过：nope');
  });

  it('tells a moved/deleted folder apart from a revoked permission', async () => {
    folders.set('f1', { name: 'Gone', root: fakeDirectory('Gone', {}, { stale: true }), permission: 'granted' });
    folders.set('f2', { name: 'Locked', root: fakeDirectory('Locked', {}), permission: 'prompt' });
    const result = await grepLocalFolders({ pattern: 'x' });
    expect(result.error).toContain('已被移动或删除：Gone');
    expect(result.error).toContain('读取权限已失效：Locked');
  });

  it('rejects an empty pattern', async () => {
    expect((await grepLocalFolders({ pattern: '  ' })).error).toContain('pattern 不能为空');
  });
});
