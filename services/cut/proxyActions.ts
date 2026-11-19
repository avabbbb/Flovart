// 代理素材的设置 / 清除：引擎负责转码与存储，store 记录"这个素材有 N p 代理"（随时间线一起持久化）。
// 代理是预览缓存而不是剪辑操作，所以不进撤销栈。
import { cutStore, getCutProject } from './cutStore';
import { ensureSourceLoaded, withCutEngine } from './runtime';
import { findSource, type CutProject } from './timeline';

function withProxy(project: CutProject, sourceId: string, height: number | null): CutProject {
  return {
    ...project,
    sources: project.sources.map(source => {
      if (source.id !== sourceId) return source;
      if (height === null) { const { proxy: _drop, ...rest } = source; return rest; }
      return { ...source, proxy: { height } };
    }),
  };
}

export async function setCutProxy(sourceId: string, height: 540 | 720, _source: 'ui' | 'agent' = 'ui', onProgress?: (progress: number) => void): Promise<{ ok: boolean; error?: string; height?: number }> {
  const record = findSource(getCutProject(), sourceId);
  if (!record || record.kind !== 'video') return { ok: false, error: 'not a video source' };
  try {
    return await withCutEngine(async engine => {
      if (!(await ensureSourceLoaded(engine, record))) return { ok: false, error: 'media offline (re-import the local file)' };
      const done = await engine.createProxy(sourceId, height, onProgress);
      if (!done) return { ok: false, error: 'cancelled' };
      cutStore.getState().replace(withProxy(getCutProject(), sourceId, height));
      return { ok: true, height };
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function clearCutProxy(sourceId: string, _source: 'ui' | 'agent' = 'ui') {
  const record = findSource(getCutProject(), sourceId);
  await withCutEngine(engine => engine.deleteProxy(sourceId, record?.proxy?.height));
  cutStore.getState().replace(withProxy(getCutProject(), sourceId, null));
}

export function cancelCutProxy(sourceId: string) {
  void import('./runtime').then(runtime => runtime.peekCutEngine()?.then(engine => engine.cancelProxy(sourceId)));
}
