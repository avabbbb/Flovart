// Cut Agent 工具的实现（懒加载：第一次调用 Cut 工具时才下载，主包只含工具说明与 Schema）。
import { cutStore } from './cutStore';
import { applyCutOperations, describeInspector, describeSubtitles, describeTimeline, diffCutProjects, type CutAgentOperation } from './agentOps';
import { findClip, findSource, projectDuration, setSubtitleStyle } from './timeline';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }], details: value as Record<string, unknown> });

function viewState() {
  const state = cutStore.getState();
  return { playhead: state.playhead, selection: state.selection, snapping: state.snapping, canUndo: state.doc.past.length > 0, canRedo: state.doc.future.length > 0 };
}

function bind(projectId: string) {
  cutStore.getState().open(projectId);
  return cutStore.getState().doc.present;
}

export function commitOps(projectId: string, operations: CutAgentOperation[], label: string) {
  const before = bind(projectId);
  const outcome = applyCutOperations(before, operations);
  if (!outcome.ok) return { ok: false, error: outcome.error, results: outcome.results };
  cutStore.getState().apply(outcome.project, label, 'agent');
  const created = outcome.results.map(item => item.clipId).filter((id): id is string => !!id);
  if (created.length) cutStore.getState().select(created.filter(id => !!findClip(outcome.project, id)));
  return { ok: true, results: outcome.results, diff: diffCutProjects(before, outcome.project) };
}

export async function run_get_timeline(projectId: string, _params: unknown, _signal?: AbortSignal) {
    return text(describeTimeline(bind(projectId), viewState()));
  }

export async function run_get_assets(projectId: string, _params: unknown, _signal?: AbortSignal) {
        const project = bind(projectId);
        const { peekCutEngine } = await import('./runtime');
        const engine = await peekCutEngine();
        return text({
          assets: project.sources.map(source => ({
            sourceId: source.id,
            kind: source.kind,
            name: source.name,
            duration: source.duration,
            width: source.width,
            height: source.height,
            ...(source.size ? { sizeBytes: source.size } : {}),
            origin: source.origin.type === 'canvas' ? { canvasNodeId: source.origin.nodeId } : { localFile: source.origin.fileName },
            offline: source.origin.type === 'file' && !engine?.has(source.id),
            proxy: engine ? engine.proxyInfo(source.id) : (source.proxy ? { status: 'ready', height: source.proxy.height } : { status: 'none' }),
            usedBy: project.clips.filter(clip => clip.sourceId === source.id).map(clip => clip.id),
          })),
        });
      }

export async function run_get_inspector(projectId: string, params: unknown, _signal?: AbortSignal) {
        const project = bind(projectId);
        const { clipId, clipIds } = params as { clipId?: string; clipIds?: string[] };
        const ids = clipIds?.length ? clipIds : clipId ? [clipId] : cutStore.getState().selection;
        if (!ids.length) return text({ ok: false, error: 'no clip selected; pass clipId (see iris_cut_get_timeline)' });
        const playhead = cutStore.getState().playhead;
        return text({ clips: ids.map(id => { const clip = findClip(project, id); return clip ? describeInspector(project, clip, playhead) : { id, error: 'not found' }; }) });
      }

export async function run_get_subtitles(projectId: string, _params: unknown, _signal?: AbortSignal) {
    return text(describeSubtitles(bind(projectId)));
  }

export async function run_snapshot_frame(projectId: string, params: unknown, _signal?: AbortSignal) {
        bind(projectId);
        const { time, maxWidth } = params as { time?: number; maxWidth?: number };
        const { snapshotCutFrame } = await import('./runtime');
        const shot = await snapshotCutFrame(time ?? cutStore.getState().playhead, Math.max(160, Math.min(1920, maxWidth ?? 960)));
        const note = `t=${shot.time.toFixed(2)}s ${shot.width}×${shot.height}${shot.missing.length ? `；离线素材：${shot.missing.join(', ')}` : ''}`;
        return { content: [{ type: 'text' as const, text: note }, { type: 'image' as const, data: shot.dataUrl.slice(shot.dataUrl.indexOf(',') + 1), mimeType: 'image/jpeg' }], details: { time: shot.time, width: shot.width, height: shot.height, missing: shot.missing } };
      }

export async function run_edit(projectId: string, params: unknown, _signal?: AbortSignal) {
    return text(commitOps(projectId, (params as { operations: CutAgentOperation[] }).operations, 'agent edit'));
  }

export async function run_subtitles(projectId: string, raw: unknown, _signal?: AbortSignal) {
        const params = raw as Record<string, unknown> & { action: string };
        const project = bind(projectId);
        const { parseSubtitleFile, toSrt, toVtt, cuesFromClips } = await import('./subtitles');
        switch (params.action) {
          case 'add': return text(commitOps(projectId, [{ op: 'add_subtitle', start: params.start as number, end: params.end as number, text: String(params.text ?? '') }], 'agent add subtitle'));
          case 'update': return text(commitOps(projectId, [{ op: 'update_subtitle', clipId: params.clipId as string, text: params.text as string | undefined, start: params.start as number | undefined, end: params.end as number | undefined, style: params.style as never }], 'agent edit subtitle'));
          case 'delete': return text(commitOps(projectId, [{ op: 'delete_subtitles', clipIds: (params.clipIds as string[]) ?? (params.clipId ? [params.clipId as string] : []) }], 'agent delete subtitles'));
          case 'split': return text(commitOps(projectId, [{ op: 'split_subtitle', clipId: params.clipId as string, cursor: params.cursor as number }], 'agent split subtitle'));
          case 'merge': return text(commitOps(projectId, [{ op: 'merge_subtitle', clipId: params.clipId as string }], 'agent merge subtitle'));
          case 'replace_all': return text(commitOps(projectId, [{ op: 'replace_subtitles', cues: (params.cues as Array<{ start: number; end: number; text: string }>) ?? [] }], 'agent replace subtitles'));
          case 'style': {
            if (!params.style || typeof params.style !== 'object') return text({ ok: false, error: 'style is required' });
            const result = setSubtitleStyle(project, params.style as never, { clearOverrides: !!params.clearOverrides });
            cutStore.getState().apply(result.project, 'agent subtitle style', 'agent');
            return text({ ok: true, style: result.project.subtitleStyle });
          }
          case 'import_srt': {
            const parsed = parseSubtitleFile(/^\s*WEBVTT/.test(String(params.content ?? '')) ? 'in.vtt' : 'in.srt', String(params.content ?? ''));
            if (!parsed.cues.length) return text({ ok: false, error: 'no valid cues', skipped: parsed.skipped });
            return text({ ...commitOps(projectId, [{ op: 'replace_subtitles', cues: parsed.cues }], 'agent import subtitles'), skipped: parsed.skipped });
          }
          case 'export_srt': {
            const cues = cuesFromClips(project.clips);
            return text({ ok: true, format: params.format === 'vtt' ? 'vtt' : 'srt', content: params.format === 'vtt' ? toVtt(cues) : toSrt(cues) });
          }
          default: return text({ ok: false, error: 'action must be add|update|delete|split|merge|replace_all|style|import_srt|export_srt' });
        }
      }

export async function run_import(projectId: string, raw: unknown, _signal?: AbortSignal) {
        const params = raw as { nodeId?: string; url?: string; addToTimeline?: boolean; trackId?: string; start?: number };
        if (!params.nodeId === !params.url) return text({ ok: false, error: 'give exactly one of nodeId or url' });
        const before = bind(projectId);
        const runtime = await import('./runtime');
        try {
          const imported = await runtime.withCutEngine(engine => params.nodeId
            ? runtime.importCanvasNode(engine, params.nodeId, params, 'agent')
            : runtime.importUrl(engine, params.url!, params, 'agent'));
          return text({ ok: true, source: imported.source, clipId: imported.clipId, diff: diffCutProjects(before, cutStore.getState().doc.present) });
        } catch (error) {
          return text({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }

export async function run_proxy(projectId: string, raw: unknown, _signal?: AbortSignal) {
        const params = raw as { action: string; sourceId?: string; height?: number };
        const project = bind(projectId);
        const height = params.height === 720 ? 720 : 540;
        const { setCutProxy, clearCutProxy } = await import('./proxyActions');
        if (params.action === 'clear') {
          if (!params.sourceId || !findSource(project, params.sourceId)) return text({ ok: false, error: 'sourceId not found' });
          await clearCutProxy(params.sourceId, 'agent');
          return text({ ok: true, sourceId: params.sourceId, proxy: 'none' });
        }
        const ids = params.action === 'create_all' ? project.sources.filter(source => source.kind === 'video').map(source => source.id) : params.sourceId ? [params.sourceId] : [];
        if (!ids.length) return text({ ok: false, error: 'no video source (pass sourceId from iris_cut_get_assets)' });
        const results = [];
        for (const id of ids) {
          const source = findSource(project, id);
          if (!source || source.kind !== 'video') { results.push({ sourceId: id, ok: false, error: 'not a video source' }); continue; }
          results.push({ sourceId: id, ...(await setCutProxy(id, height, 'agent')) });
        }
        return text({ ok: results.every(item => item.ok), results });
      }

export async function run_playback(projectId: string, raw: unknown, _signal?: AbortSignal) {
        const params = raw as { action: string; time?: number; clipIds?: string[] };
        const project = bind(projectId);
        const store = cutStore.getState();
        switch (params.action) {
          case 'seek':
            if (typeof params.time !== 'number' || !Number.isFinite(params.time)) return text({ ok: false, error: 'time is required' });
            store.setPlayhead(params.time);
            return text({ ok: true, playhead: cutStore.getState().playhead, duration: projectDuration(project) });
          case 'play': case 'pause': {
            const open = !!document.querySelector('[data-cut-editor]');
            store.setPlaying(params.action === 'play');
            return text({ ok: open, playing: params.action === 'play', ...(open ? {} : { note: 'Cut 页没有打开，播放请求会在打开后生效' }) });
          }
          case 'undo': return text({ ok: store.undo(), timeline: describeTimeline(cutStore.getState().doc.present, viewState()) });
          case 'redo': return text({ ok: store.redo(), timeline: describeTimeline(cutStore.getState().doc.present, viewState()) });
          case 'select': store.select(params.clipIds ?? []); return text({ ok: true, selection: cutStore.getState().selection });
          default: return text({ ok: false, error: 'action must be seek|play|pause|undo|redo|select' });
        }
      }

export async function run_export(projectId: string, raw: unknown, signal?: AbortSignal) {
        const params = raw as { toCanvas?: boolean; fileName?: string };
        const project = bind(projectId);
        if (projectDuration(project) <= 0) return text({ ok: false, error: 'the timeline is empty' });
        const runtime = await import('./runtime');
        try {
          const result = await runtime.exportCutMp4({ signal });
          const fileName = (params.fileName || 'iris-cut').replace(/[\\/:*?"<>|]+/g, '-').replace(/(\.mp4)?$/i, '.mp4');
          if (params.toCanvas === false) return text({ ok: true, info: result.info, sizeBytes: result.blob.size, note: 'not added to the canvas (toCanvas=false)' });
          const sent = await runtime.sendBlobToCanvas(projectId, result.blob, fileName);
          return text({ ok: sent.ok, info: result.info, sizeBytes: result.blob.size, ...(sent.ok ? { nodeIds: sent.nodeIds } : { error: sent.error }) });
        } catch (error) {
          return text({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
