import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveTestTempRoot } from '../scripts/test-temp-root.mjs';

const require = createRequire(import.meta.url);
const roots: string[] = [];
const testTempRoot = resolveTestTempRoot(process.cwd(), 'vitest');

function createMainProcessHarness(
  rootDir: string,
  importItems: (paths: string[]) => unknown,
  activeProjectId = 'resolve-project-1',
  projectOverride?: Record<string, unknown>,
  integrationLoadError?: Error,
) {
  const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
  const importedPaths: string[][] = [];
  let windowOptions: Record<string, unknown> | undefined;
  const fakeProject = projectOverride || {
    GetUniqueId: () => activeProjectId,
    GetMediaPool: async () => ({
      ImportMedia: async (paths: string[]) => {
        importedPaths.push(paths);
        return importItems(paths);
      },
    }),
  };
  const fakeResolve = {
    GetProjectManager: async () => ({ GetCurrentProject: async () => fakeProject }),
  };
  const fakeIntegration = {
    Initialize: vi.fn(() => true),
    GetResolve: vi.fn(async () => fakeResolve),
    CleanUp: vi.fn(),
  };
  const electron = {
    app: {
      getPath: vi.fn(() => rootDir),
      whenReady: () => Promise.resolve(),
      on: vi.fn(),
      quit: vi.fn(),
    },
    BrowserWindow: class {
      constructor(options: Record<string, unknown>) { windowOptions = options; }
      loadFile() {}
      on() {}
    },
    ipcMain: {
      handle: (name: string, handler: (...args: any[]) => Promise<unknown>) => handlers.set(name, handler),
    },
    shell: { openExternal: vi.fn() },
  };
  const resolveDirectory = join(process.cwd(), 'integrations', 'studio', 'resolve');
  const source = readFileSync(join(resolveDirectory, 'main.js'), 'utf8');
  const localRequire = (specifier: string) => {
    if (specifier === 'electron') return electron;
    if (specifier === './WorkflowIntegration.node') {
      if (integrationLoadError) throw integrationLoadError;
      return fakeIntegration;
    }
    return require(specifier.startsWith('./') ? join(resolveDirectory, specifier) : specifier);
  };
  vm.runInNewContext(source, {
    require: localRequire,
    __dirname: resolveDirectory,
    process,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    module: { exports: {} },
    exports: {},
  });
  return { handlers, importedPaths, fakeIntegration, electron, get windowOptions() { return windowOptions; } };
}

function temporaryRoot() {
  const root = mkdtempSync(join(testTempRoot, 'iris-resolve-import-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Resolve Media Pool import lifetime', () => {
  it('keeps the Resolve panel minimum width at 280 pixels', async () => {
    const harness = createMainProcessHarness(temporaryRoot(), () => []);

    await vi.waitFor(() => expect(harness.windowOptions).toMatchObject({ minWidth: 280 }));
  });

  it('imports from persistent user data and keeps the verified artifact after Resolve accepts it', async () => {
    const rootDir = temporaryRoot();
    const { handlers, importedPaths } = createMainProcessHarness(rootDir, () => [{ GetUniqueId: () => 'media-pool-item-1' }]);
    await Promise.resolve();
    const bytes = Buffer.from('durable candidate');
    const artifact = { artifactId: 'artifact_123', taskId: 'task_456', mimeType: 'image/png', bytes: new Uint8Array(bytes) };
    const persistenceReceipt = await handlers.get('flovart:persist-artifact')?.({ artifact }) as Record<string, unknown>;
    expect(persistenceReceipt).toMatchObject({ status: 'persisted', artifactId: 'artifact_123', taskId: 'task_456', byteSize: bytes.length });
    expect(persistenceReceipt).not.toHaveProperty('filePath');
    const result = await handlers.get('flovart:import-artifact')?.({
      artifact: { artifactId: 'artifact_123', taskId: 'task_456', mimeType: 'image/png', sha256: persistenceReceipt.sha256, byteSize: bytes.length },
      persistence: persistenceReceipt,
      target: { kind: 'media-pool', projectId: 'resolve-project-1', sourceSelectionId: 'clip-1' },
    });

    expect(importedPaths).toHaveLength(1);
    expect(importedPaths[0][0]).toContain(join(rootDir, 'artifacts', 'resolve'));
    expect(readFileSync(importedPaths[0][0])).toEqual(bytes);
    expect(result).toMatchObject({
      ok: true,
      importStatus: 'confirmed',
      targetId: 'media-pool',
      mediaPoolItemId: 'media-pool-item-1',
      artifactId: 'artifact_123',
      taskId: 'task_456',
      byteSize: bytes.length,
    });
  });

  it('keeps the artifact when Resolve rejects the Media Pool import so the bytes are not lost', async () => {
    const rootDir = temporaryRoot();
    const { handlers, importedPaths } = createMainProcessHarness(rootDir, () => []);
    await Promise.resolve();
    const bytes = Buffer.from('retry candidate');
    const result = await handlers.get('flovart:import-artifact')?.({
      artifact: { artifactId: 'artifact_retry', mimeType: 'video/mp4', bytes: Array.from(bytes) },
      target: { kind: 'media-pool', projectId: 'resolve-project-1' },
    }) as { ok: boolean; artifactId: string };

    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('importStatus', 'rejected');
    expect(result.artifactId).toBe('artifact_retry');
    expect(readFileSync(importedPaths[0][0])).toEqual(bytes);
  });

  it('does not import a frozen candidate into a different active Resolve project', async () => {
    const rootDir = temporaryRoot();
    const { handlers, importedPaths } = createMainProcessHarness(rootDir, () => [{ GetUniqueId: () => 'wrong-project-item' }], 'project-new');
    await Promise.resolve();
    const bytes = Buffer.from('bound project candidate');
    const persistenceReceipt = await handlers.get('flovart:persist-artifact')?.({ artifact: {
      artifactId: 'artifact_bound', mimeType: 'image/png', bytes: Array.from(bytes),
    } }) as Record<string, unknown>;
    const result = await handlers.get('flovart:import-artifact')?.({
      artifact: { artifactId: 'artifact_bound', mimeType: 'image/png', sha256: persistenceReceipt.sha256, byteSize: bytes.length },
      persistence: persistenceReceipt,
      target: { kind: 'media-pool', projectId: 'project-original', sourceSelectionId: 'clip-original' },
    }) as { ok: boolean; message: string };

    expect(result.ok).toBe(false);
    expect(result.message).toContain('项目已改变');
    expect(importedPaths).toHaveLength(0);
    const artifactFile = readdirSync(join(rootDir, 'artifacts', 'resolve')).find(name => name.endsWith('.png'));
    expect(artifactFile).toBeTruthy();
    expect(readFileSync(join(rootDir, 'artifacts', 'resolve', artifactFile!))).toEqual(bytes);
  });

  it('rejects a same-size tampered staged candidate before calling Resolve', async () => {
    const rootDir = temporaryRoot();
    const { handlers, importedPaths } = createMainProcessHarness(rootDir, () => [{ GetUniqueId: () => 'unexpected-item' }]);
    await Promise.resolve();
    const bytes = Buffer.from('original-bytes');
    const persistenceReceipt = await handlers.get('flovart:persist-artifact')?.({ artifact: {
      artifactId: 'artifact_tamper', mimeType: 'image/png', bytes: Array.from(bytes),
    } }) as Record<string, unknown>;
    const fileName = readdirSync(join(rootDir, 'artifacts', 'resolve')).find(name => name.endsWith('.png'))!;
    writeFileSync(join(rootDir, 'artifacts', 'resolve', fileName), Buffer.from('tampered-bytes'));

    const result = await handlers.get('flovart:import-artifact')?.({
      artifact: { artifactId: 'artifact_tamper', mimeType: 'image/png', sha256: persistenceReceipt.sha256, byteSize: bytes.length },
      persistence: persistenceReceipt,
      target: { kind: 'media-pool', projectId: 'resolve-project-1' },
    }) as { ok: boolean; importStatus: string; message: string };
    expect(result).toMatchObject({ ok: false, importStatus: 'rejected' });
    expect(result.message).toContain('完整性校验失败');
    expect(importedPaths).toHaveLength(0);
  });

  it('does not expose native module load paths through the Resolve context contract', async () => {
    const rootDir = temporaryRoot();
    const nativePath = 'H:\\private\\Iris\\WorkflowIntegration.node';
    const { handlers } = createMainProcessHarness(
      rootDir,
      () => [],
      'resolve-project-1',
      undefined,
      new Error(`Cannot find module '${nativePath}'`),
    );
    await Promise.resolve();

    const result = await handlers.get('flovart:context')?.() as { available: boolean; title: string };
    expect(result.available).toBe(false);
    expect(result.title).toContain('无法连接 DaVinci Resolve');
    expect(result.title).not.toContain(nativePath);
  });

  it('redacts absolute paths from Resolve materialization getter exceptions', async () => {
    const rootDir = temporaryRoot();
    const nativePath = 'C:\\private\\media\\source.mov';
    const clip = {
      GetUniqueId: () => 'clip-1',
      GetName: () => 'source.mov',
      GetClipProperty: () => { throw new Error(`Could not read ${nativePath}`); },
    };
    const project = {
      GetUniqueId: () => 'resolve-project-1',
      GetMediaPool: async () => ({ GetSelectedClips: async () => [clip] }),
    };
    const { handlers } = createMainProcessHarness(rootDir, () => [], 'resolve-project-1', project);
    await Promise.resolve();

    const result = handlers.get('flovart:materialize-clip')?.({
      selection: {
        selectionId: 'clip-1',
        locator: { projectId: 'resolve-project-1', clipId: 'clip-1' },
      },
    });
    const error = await result?.then(() => undefined, value => value as Error);
    expect(error?.message).toBe('无法安全读取 Resolve 当前选择；请重新选择素材后重试。');
    expect(error?.message).not.toContain(nativePath);
  });

  it('rejects an import without a frozen Resolve project ID', async () => {
    const rootDir = temporaryRoot();
    const { handlers, importedPaths } = createMainProcessHarness(rootDir, () => [{ GetUniqueId: () => 'unexpected-item' }]);
    await Promise.resolve();
    const result = await handlers.get('flovart:import-artifact')?.({
      artifact: { artifactId: 'artifact_missing_target', mimeType: 'image/png', bytes: [1, 2, 3] },
      target: { kind: 'media-pool' },
    }) as { ok: boolean; importStatus: string; message: string };

    expect(result).toMatchObject({ ok: false, importStatus: 'rejected' });
    expect(result.message).toContain('冻结的项目身份');
    expect(importedPaths).toHaveLength(0);
  });

  it('rejects a selection that changes between snapshot verification and clip materialization', async () => {
    const rootDir = temporaryRoot();
    const sourcePath = join(rootDir, 'source.mp4');
    writeFileSync(sourcePath, Buffer.from('source media'));
    const clip = (id: string) => ({
      GetUniqueId: () => id,
      GetName: () => `${id}.mp4`,
      GetClipProperty: () => sourcePath,
    });
    let reads = 0;
    const mediaPool = {
      GetSelectedClips: async () => {
        reads += 1;
        return [reads === 1 ? clip('clip-original') : clip('clip-new')];
      },
    };
    const project = {
      GetUniqueId: () => 'resolve-project-1',
      GetMediaPool: async () => mediaPool,
    };
    const { handlers } = createMainProcessHarness(rootDir, () => [], 'resolve-project-1', project);
    await Promise.resolve();

    await expect(handlers.get('flovart:materialize-clip')?.({
      selection: {
        selectionId: 'clip-original',
        label: 'clip-original.mp4',
        locator: { projectId: 'resolve-project-1', clipId: 'clip-original' },
      },
    })).rejects.toThrow('Resolve 当前 Media Pool 选择已变化');
    expect(reads).toBe(2);
  });

  it('returns clip and project basenames without exposing local paths in the host panel contract', async () => {
    const rootDir = temporaryRoot();
    const project = {
      GetUniqueId: () => 'resolve-project-1',
      GetName: () => 'C:\\Users\\ava\\Private\\Resolve_Project.drp',
      GetMediaPool: async () => ({
        GetSelectedClips: async () => [{
          GetUniqueId: () => 'clip-1',
          GetName: () => 'C:\\Users\\ava\\Private\\Interview_A.mov',
          GetClipProperty: () => 'C:\\Users\\ava\\Private\\Interview_A.mov',
        }],
      }),
    };
    const { handlers } = createMainProcessHarness(rootDir, () => [], 'resolve-project-1', project);
    await Promise.resolve();

    const context = await handlers.get('flovart:context')?.() as Record<string, unknown>;
    const selected = await handlers.get('flovart:selection')?.() as Record<string, unknown>;
    expect(context.documentName).toBe('Resolve_Project.drp');
    expect(selected.label).toBe('Interview_A.mov');
    expect(JSON.stringify({ context, selected })).not.toContain('C:\\Users\\ava');
  });

  it('reports an unknown outcome if Resolve throws after receiving Media Pool import and never suggests blind retry', async () => {
    const rootDir = temporaryRoot();
    const { handlers, importedPaths } = createMainProcessHarness(rootDir, paths => {
      expect(paths).toHaveLength(1);
      throw new Error('Resolve native import failed at C:\\private\\media\\candidate.mp4');
    });
    await Promise.resolve();
    const bytes = Buffer.from('ambiguous import');
    const persistenceReceipt = await handlers.get('flovart:persist-artifact')?.({ artifact: {
      artifactId: 'artifact_unknown', mimeType: 'image/png', bytes: new Uint8Array(bytes),
    } }) as Record<string, unknown>;
    const result = await handlers.get('flovart:import-artifact')?.({
      artifact: { artifactId: 'artifact_unknown', mimeType: 'image/png', sha256: persistenceReceipt.sha256, byteSize: bytes.length },
      persistence: persistenceReceipt,
      target: { kind: 'media-pool', projectId: 'resolve-project-1' },
    }) as { ok: boolean; importStatus: string; message: string };

    expect(result).toMatchObject({ ok: false, importStatus: 'unknown' });
    expect(result.message).toContain('不要重试');
    expect(result.message).not.toContain('C:\\private');
    expect(importedPaths).toHaveLength(1);
  });
});
