import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LocalFolderError,
  adoptLocalFolderHandle,
  createThumbnailLimiter,
  forgetLocalFolderSource,
  getLocalFolderPermission,
  listLocalFolderSources,
  localFolderHref,
  localFolderMediaKind,
  parseLocalFolderHref,
  readLocalFolderFile,
  readLocalFolderThumbnail,
  requestLocalFolderPermission,
  scanLocalFolder,
  writeLocalFolderThumbnail,
} from '../services/localFolderSource';
import { loadFallbackMediaBlob } from '../components/workflow/media';
import { fakeDirectoryHandle, fakeFileHandle, type FakeDirectoryHandle } from './fixtures/fakeFolderHandle';

const createdFolders: string[] = [];

afterEach(async () => {
  await Promise.all(createdFolders.splice(0).map(id => forgetLocalFolderSource(id)));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sampleFolder(permission: PermissionState = 'granted') {
  return fakeDirectoryHandle('产品素材', [
    ['hero.png', fakeFileHandle({ name: 'hero.png', type: 'image/png', size: 8 })],
    ['notes.psd', fakeFileHandle({ name: 'notes.psd', type: 'image/vnd.adobe.photoshop', size: 8 })],
    ['.cache.png', fakeFileHandle({ name: '.cache.png', type: 'image/png', size: 8 })],
    ['clips', fakeDirectoryHandle('clips', [
      ['take-01.mp4', fakeFileHandle({ name: 'take-01.mp4', type: 'video/mp4', size: 12 })],
      ['raw', fakeDirectoryHandle('raw', [
        ['voice.wav', fakeFileHandle({ name: 'voice.wav', type: 'audio/wav', size: 16 })],
      ])],
    ])],
  ], permission);
}

async function adopt(handle: FakeDirectoryHandle) {
  const source = await adoptLocalFolderHandle(handle);
  createdFolders.push(source.id);
  return source;
}

describe('local folder reference source', () => {
  it('round-trips folder hrefs including nested non-ascii paths', () => {
    const href = localFolderHref('folder-1', '产品图/主图 01.png');
    expect(href.startsWith('local-folder:folder-1/')).toBe(true);
    expect(parseLocalFolderHref(href)).toEqual({ folderId: 'folder-1', relativePath: '产品图/主图 01.png' });
    expect(parseLocalFolderHref('https://example.com/a.png')).toBeNull();
    expect(parseLocalFolderHref('local-folder:folder-1')).toBeNull();
  });

  it('maps media extensions and rejects non-media files', () => {
    expect(localFolderMediaKind('a.PNG')?.kind).toBe('image');
    expect(localFolderMediaKind('b.mov')?.kind).toBe('video');
    expect(localFolderMediaKind('c.flac')?.kind).toBe('audio');
    expect(localFolderMediaKind('d.psd')).toBeNull();
  });

  it('scans only media within the configured depth and entry limits', async () => {
    const source = await adopt(sampleFolder());
    const entries = await scanLocalFolder(source.id);
    expect(entries.map(entry => entry.relativePath)).toEqual([
      'clips/raw/voice.wav',
      'clips/take-01.mp4',
      'hero.png',
    ]);
    expect(entries.every(entry => entry.folderId === source.id)).toBe(true);
    expect(entries.find(entry => entry.name === 'take-01.mp4')).toMatchObject({ kind: 'video', mimeType: 'video/mp4', bytes: 12 });

    const shallow = await scanLocalFolder(source.id, { maxDepth: 1 });
    expect(shallow.map(entry => entry.relativePath)).toEqual(['hero.png']);
  });

  it('reads nested original files and reports moved files with a relocation hint', async () => {
    const source = await adopt(sampleFolder());
    const file = await readLocalFolderFile(source.id, 'clips/take-01.mp4');
    expect(file.name).toBe('take-01.mp4');
    expect(file.size).toBe(12);

    await expect(readLocalFolderFile(source.id, 'clips/take-99.mp4')).rejects.toMatchObject({
      name: 'LocalFolderError',
      code: 'MISSING',
    });
    await expect(readLocalFolderFile(source.id, 'clips/missing.mp4')).rejects.toThrow(/重新定位本地文件夹/);
  });

  it('resolves a local-folder href through the media layer without copying bytes', async () => {
    const source = await adopt(sampleFolder());
    const blob = await loadFallbackMediaBlob(localFolderHref(source.id, 'hero.png'));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(8);

    await expect(loadFallbackMediaBlob(localFolderHref(source.id, 'gone.png'))).rejects.toBeInstanceOf(LocalFolderError);
  });

  it('keeps the folder usable in-session when the directory handle cannot be persisted', async () => {
    const source = await adopt(sampleFolder());
    // 假句柄带方法，无法结构化克隆进 IndexedDB，服务应退回会话内内存句柄。
    expect(source.persisted).toBe(false);
    expect(await getLocalFolderPermission(source.id)).toBe('granted');
    expect((await scanLocalFolder(source.id)).length).toBeGreaterThan(0);
    const listed = await listLocalFolderSources();
    expect(listed.find(item => item.id === source.id)?.persisted).toBe(false);
  });

  it('reports permission state and re-requests it on demand', async () => {
    const source = await adopt(sampleFolder('prompt'));
    expect(await getLocalFolderPermission(source.id)).toBe('prompt');
    await expect(scanLocalFolder(source.id)).rejects.toMatchObject({ code: 'PERMISSION' });
    expect(await requestLocalFolderPermission(source.id)).toBe(true);
    await expect(scanLocalFolder(source.id)).resolves.toBeInstanceOf(Array);
  });

  it('reports missing sources instead of guessing a path', async () => {
    expect(await getLocalFolderPermission('never-existed')).toBe('missing');
    await expect(scanLocalFolder('never-existed')).rejects.toMatchObject({ code: 'MISSING' });
    await expect(readLocalFolderFile('never-existed', 'a.png')).rejects.toMatchObject({ code: 'MISSING' });
  });

  it('rejects non-directory drops with a clear message', async () => {
    await expect(adoptLocalFolderHandle({ kind: 'file', name: 'a.png' })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    await expect(adoptLocalFolderHandle(null)).rejects.toBeInstanceOf(LocalFolderError);
  });

  it('caches thumbnails per file version and clears them with the source', async () => {
    const source = await adopt(sampleFolder());
    const entry = { folderId: source.id, relativePath: 'hero.png', lastModified: 1 };
    expect(await readLocalFolderThumbnail(entry)).toBeNull();

    const thumbnail = new Blob(['thumb'], { type: 'image/jpeg' });
    await writeLocalFolderThumbnail(entry, thumbnail);
    // fake-indexeddb 会把 jsdom Blob 克隆成普通对象，这里只断言缓存已写入。
    expect(await readLocalFolderThumbnail(entry)).not.toBeNull();
    // 原文件改动后 lastModified 变化，旧缩略图自动失效。
    expect(await readLocalFolderThumbnail({ ...entry, lastModified: 2 })).toBeNull();

    await forgetLocalFolderSource(source.id);
    expect(await readLocalFolderThumbnail(entry)).toBeNull();
    expect((await listLocalFolderSources()).some(item => item.id === source.id)).toBe(false);
  });

  it('caps concurrent thumbnail generation', async () => {
    const limit = createThumbnailLimiter(2);
    let active = 0;
    let peak = 0;
    const run = () => limit(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
    });
    await Promise.all([run(), run(), run(), run(), run()]);
    expect(peak).toBeLessThanOrEqual(2);
    expect(peak).toBeGreaterThan(1);
  });
});
