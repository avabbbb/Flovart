// Cut 运行时：媒体引擎（mediabunny，懒加载）的引用计数生命周期 + UI 与 Agent 共用的媒体操作
// （导入、恢复画布素材、抽帧快照、导出、代理）。最后一个持有者释放时 dispose 全部解码资源。
import { cutStore, getCutProject } from './cutStore';
import { canvasSourceId, mediaKindOfFile } from './canvasMedia';
import { addClip, addSource, findSource, projectDuration, type CutProject, type CutSource, type CutSourceKind } from './timeline';
import type { CutMediaEngine } from './mediaEngine';
import type { CutExportProgress } from './render';
import type { WorkflowNode } from '../../components/workflow/types';

let enginePromise: Promise<CutMediaEngine> | null = null;
let holders = 0;
const loadingSources = new Map<string, Promise<boolean>>();
const listeners = new Set<() => void>();
let revision = 0;

/** 媒体可用性变了（素材加载 / 释放 / 代理生成）就通知 UI 重算。 */
export function subscribeCutMedia(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function cutMediaRevision() { return revision; }
function bump() { revision += 1; listeners.forEach(listener => listener()); }

export async function acquireCutEngine(): Promise<CutMediaEngine> {
  holders += 1;
  if (!enginePromise) {
    enginePromise = import('./mediaEngine').then(module => {
      const engine = new module.CutMediaEngine();
      engine.onProxyChange = bump;
      return engine;
    });
  }
  return enginePromise;
}

export function releaseCutEngine() {
  holders = Math.max(0, holders - 1);
  if (holders > 0 || !enginePromise) return;
  const current = enginePromise;
  enginePromise = null;
  loadingSources.clear();
  void current.then(engine => { engine.dispose(); bump(); });
}

/** 在持有引擎的期间跑一个操作（Agent 工具在 Cut 没打开时也能用）。 */
export async function withCutEngine<T>(run: (engine: CutMediaEngine) => Promise<T>): Promise<T> {
  const engine = await acquireCutEngine();
  try { return await run(engine); } finally { releaseCutEngine(); }
}

export function peekCutEngine(): Promise<CutMediaEngine> | null { return enginePromise; }

/** 当前 Cut 绑定的画布项目的节点（直接读画布 store；Cut 页没打开时 Agent 工具也能找到画布素材）。 */
async function workflowNodes(): Promise<WorkflowNode[]> {
  const { useWorkflowStore } = await import('../../components/workflow/store');
  const { projects, activeProjectId } = useWorkflowStore.getState();
  const id = cutStore.getState().projectId ?? activeProjectId;
  return projects.find(project => project.id === id)?.nodes ?? [];
}

async function loadNodeBlob(node: Pick<WorkflowNode, 'metadata'> | undefined, fallback?: { storageKey?: string; href?: string }) {
  const { loadWorkflowMediaBlob } = await import('../../components/workflow/media');
  return loadWorkflowMediaBlob(node?.metadata.storageKey ?? fallback?.storageKey, node?.metadata.href ?? fallback?.href, node?.metadata.artifactRef);
}

/** 确保素材字节在引擎里：画布素材从画布存储读，本地文件只能等用户重新导入。 */
export function ensureSourceLoaded(engine: CutMediaEngine, source: CutSource): Promise<boolean> {
  if (engine.has(source.id)) return Promise.resolve(true);
  if (source.origin.type !== 'canvas') return Promise.resolve(false);
  const pending = loadingSources.get(source.id);
  if (pending) return pending;
  const origin = source.origin;
  const job = (async () => {
    const node = (await workflowNodes()).find(item => item.id === origin.nodeId);
    const blob = await loadNodeBlob(node, origin);
    engine.setBlob(source.id, blob);
    await engine.restoreProxy(source).catch(() => undefined);
    bump();
    return true;
  })().catch(() => false).finally(() => loadingSources.delete(source.id));
  loadingSources.set(source.id, job);
  return job;
}

export async function ensureProjectMedia(engine: CutMediaEngine, project: CutProject = getCutProject()) {
  const results = await Promise.all(project.sources.map(source => ensureSourceLoaded(engine, source)));
  return project.sources.filter((_, index) => !results[index]).map(source => source.id);
}

/** 新素材：放进引擎 → 读元数据 → 写进时间线（走 store，可撤销）。 */
export async function importCutMedia(
  engine: CutMediaEngine,
  input: { sourceId: string; kind: CutSourceKind; name: string; blob: Blob; origin: CutSource['origin']; addToTimeline?: boolean; trackId?: string; start?: number },
  source: 'ui' | 'agent' = 'ui',
): Promise<{ source: CutSource; clipId?: string }> {
  engine.setBlob(input.sourceId, input.blob);
  const probe = await engine.probe(input.sourceId, input.kind);
  const record: CutSource = { id: input.sourceId, kind: input.kind, name: input.name, duration: probe.duration, width: probe.width, height: probe.height, hasAudio: probe.hasAudio, size: input.blob.size, origin: input.origin };
  await engine.restoreProxy(record).catch(() => undefined);
  bump();
  let next = addSource(getCutProject(), record);
  let clipId: string | undefined;
  if (input.addToTimeline !== false) {
    const added = addClip(next, { kind: input.kind, sourceId: input.sourceId, trackId: input.trackId, start: input.start });
    if (added.ok) { next = added.project; clipId = added.clipId; }
  }
  cutStore.getState().apply(next, `import ${input.name}`, source);
  if (clipId) cutStore.getState().select([clipId]);
  return { source: record, clipId };
}

export async function importCanvasNode(engine: CutMediaEngine, nodeId: string, options: { addToTimeline?: boolean; trackId?: string; start?: number } = {}, source: 'ui' | 'agent' = 'ui') {
  const node = (await workflowNodes()).find(item => item.id === nodeId);
  if (!node) throw new Error(`canvas node ${nodeId} not found`);
  if (node.type !== 'image' && node.type !== 'video' && node.type !== 'audio') throw new Error(`node ${nodeId} is ${node.type}, not image/video/audio`);
  const sourceId = canvasSourceId(nodeId);
  const existing = findSource(getCutProject(), sourceId);
  if (existing && engine.has(sourceId)) {
    if (options.addToTimeline === false) return { source: existing };
    const result = cutStore.getState().commit(addClip(getCutProject(), { kind: existing.kind, sourceId, trackId: options.trackId, start: options.start }), `add ${existing.name}`, source);
    if (!result.ok) throw new Error(result.error);
    return { source: existing, clipId: result.clipId };
  }
  const blob = await loadNodeBlob(node);
  return importCutMedia(engine, { sourceId, kind: node.type as CutSourceKind, name: node.title || node.type, blob, origin: { type: 'canvas', nodeId, storageKey: node.metadata.storageKey, href: node.metadata.href }, ...options }, source);
}

export async function importUrl(engine: CutMediaEngine, url: string, options: { addToTimeline?: boolean; trackId?: string; start?: number } = {}, source: 'ui' | 'agent' = 'ui') {
  if (!/^https?:\/\//i.test(url)) throw new Error('url must be http(s)');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`);
  const blob = await response.blob();
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'media');
  const kind = mediaKindOfFile({ type: blob.type, name });
  if (!kind) throw new Error(`unsupported media type ${blob.type || name}`);
  const { cutId } = await import('./timeline');
  return importCutMedia(engine, { sourceId: cutId('src'), kind, name, blob, origin: { type: 'file', fileName: name }, ...options }, source);
}

/** 预览在 t 的一帧（JPEG），给 Agent 看效果。 */
export async function snapshotCutFrame(t: number, maxWidth = 960): Promise<{ dataUrl: string; width: number; height: number; time: number; missing: string[] }> {
  return withCutEngine(async engine => {
    const project = getCutProject();
    const missing = await ensureProjectMedia(engine, project);
    const { CutStreamPool, renderCutFrame } = await import('./render');
    const { loadProjectFonts } = await import('./fonts');
    await loadProjectFonts(project);
    const scale = Math.min(1, maxWidth / project.width);
    const size = { width: Math.round(project.width * scale), height: Math.round(project.height * scale) };
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d')!;
    const pool = new CutStreamPool(engine, size, { preferProxy: true });
    const time = Math.max(0, Math.min(t, projectDuration(project)));
    try {
      await renderCutFrame(ctx, project, time, pool, engine, size);
    } finally {
      pool.closeAll();
    }
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
    const buffer = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000));
    return { dataUrl: `data:image/jpeg;base64,${btoa(binary)}`, ...size, time, missing };
  });
}

export interface CutExportResult { blob: Blob; info: string; videoCodec: string; audioCodec: string | null }

/** 导出 MP4（始终用原始素材，不用代理）。 */
export async function exportCutMp4(options: { signal?: AbortSignal; onProgress?: (progress: CutExportProgress) => void } = {}): Promise<CutExportResult> {
  return withCutEngine(async engine => {
    const project = getCutProject();
    const missing = await ensureProjectMedia(engine, project);
    const used = new Set(project.clips.map(clip => clip.sourceId).filter(Boolean));
    if (missing.some(id => used.has(id))) throw new Error('Some clips have offline media (local files must be re-imported).');
    const [{ MediabunnyMp4Encoder }, { exportCutProject, projectHasAudio }, { loadProjectFonts }] = await Promise.all([import('./mediaEngine'), import('./render'), import('./fonts')]);
    await loadProjectFonts(project);
    const encoder = await MediabunnyMp4Encoder.create(project, projectHasAudio(project));
    const blob = await exportCutProject(project, { backend: engine, encoder, signal: options.signal, onProgress: options.onProgress });
    const videoCodec = encoder.info.videoCodec === 'avc' ? 'H.264' : encoder.info.videoCodec.toUpperCase();
    const audioCodec = encoder.info.audioCodec ? 'AAC' : null;
    return { blob, videoCodec, audioCodec, info: `${videoCodec}${audioCodec ? ` + ${audioCodec}` : ''} · ${(blob.size / 1024 / 1024).toFixed(1)} MB` };
  });
}

/** 把成片作为视频节点放回画布（与故事版「放入素材」同一条 ingest + 提交路径，可在画布撤销）。 */
export async function sendBlobToCanvas(projectId: string, blob: Blob, fileName: string) {
  const { addStoryboardMedia } = await import('../../components/reverse/irisStoryboardActions');
  return addStoryboardMedia(projectId, [new File([blob], fileName, { type: 'video/mp4' })], 'final');
}
