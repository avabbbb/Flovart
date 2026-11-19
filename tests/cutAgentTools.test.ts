// Agent ↔ Cut：headless store、整批校验、撤销、diff、工具注册。
import { beforeEach, describe, expect, it } from 'vitest';
import { cutStore, flushCutStore } from '../services/cut/cutStore';
import { applyCutOperations, describeTimeline } from '../services/cut/agentOps';
import { createCutAgentTools, CUT_TOOL_DOCS, CUT_TOOL_NAMES } from '../services/cut/agentTools';
import { addSource, createCutProject, cutStorageKey, deserializeCutProject, subtitleClips, type CutSource } from '../services/cut/timeline';
import { runCutAction } from '../services/cut/actions';

const video = (id: string, duration = 8): CutSource => ({ id, kind: 'video', name: `${id}.mp4`, duration, width: 1920, height: 1080, hasAudio: true, origin: { type: 'canvas', nodeId: id } });

function reset(projectId = `p-${Math.random().toString(36).slice(2)}`) {
  localStorage.clear();
  cutStore.setState({ projectId: null });
  cutStore.getState().open(projectId);
  cutStore.getState().replace(addSource(addSource(createCutProject(), video('va')), video('vb', 4)));
  return projectId;
}

async function call(tools: ReturnType<typeof createCutAgentTools>, name: string, params: Record<string, unknown> = {}) {
  const tool = tools.find(item => item.name === name)!;
  const result = await tool.execute('call-1', params as never, undefined as never);
  const text = (result.content[0] as { text: string }).text;
  return JSON.parse(text);
}

describe('Cut agent tools', () => {
  let projectId: string;
  let tools: ReturnType<typeof createCutAgentTools>;
  beforeEach(() => { projectId = reset(); tools = createCutAgentTools({ projectId }); });

  it('registers every tool with a schema and documents it for the system prompt', () => {
    expect(tools.map(tool => tool.name)).toEqual([...CUT_TOOL_NAMES]);
    for (const tool of tools) {
      expect(tool.parameters).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
      expect(CUT_TOOL_DOCS).toContain(tool.name);
    }
  });

  it('reads the timeline headlessly (Cut page not mounted)', async () => {
    const timeline = await call(tools, 'iris_cut_get_timeline');
    expect(timeline).toMatchObject({ fps: 30, width: 1920, height: 1080, duration: 0 });
    expect(timeline.tracks.map((track: { kind: string }) => track.kind)).toEqual(['video', 'audio', 'text', 'subtitle']);
  });

  it('applies a batch as one undo step and returns a diff', async () => {
    const result = await call(tools, 'iris_cut_edit', { operations: [
      { op: 'add_clip', sourceId: 'va' },
      { op: 'add_clip', sourceId: 'vb' },
      { op: 'split', time: 3 },
      { op: 'set_clip', clipId: '__ignored__' },
    ] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/operation 3 \(set_clip\) failed: clip __ignored__ not found/);
    expect(cutStore.getState().doc.present.clips).toHaveLength(0);

    const ok = await call(tools, 'iris_cut_edit', { operations: [
      { op: 'add_clip', sourceId: 'va' },
      { op: 'add_clip', sourceId: 'vb' },
      { op: 'split', time: 3 },
    ] });
    expect(ok.ok).toBe(true);
    expect(ok.diff.added).toHaveLength(3);
    expect(ok.diff.duration).toBe(12);
    expect(cutStore.getState().doc.past).toHaveLength(1);
    const undo = await call(tools, 'iris_cut_playback', { action: 'undo' });
    expect(undo.ok).toBe(true);
    expect(cutStore.getState().doc.present.clips).toHaveLength(0);
    expect((await call(tools, 'iris_cut_playback', { action: 'redo' })).timeline.duration).toBe(12);
  });

  it('validates input types', async () => {
    const bad = await call(tools, 'iris_cut_edit', { operations: [{ op: 'split', time: 'soon' }] });
    expect(bad).toMatchObject({ ok: false });
    expect(bad.error).toMatch(/time must be a finite number/);
    expect((await call(tools, 'iris_cut_edit', { operations: [{ op: 'teleport' }] })).error).toMatch(/unknown op/);
    expect((await call(tools, 'iris_cut_edit', { operations: [] })).ok).toBe(false);
    expect((await call(tools, 'iris_cut_edit', { operations: [{ op: 'add_track', kind: 'hologram' }] })).ok).toBe(false);
  });

  it('sets properties and keyframes and reads them back through the inspector', async () => {
    const added = await call(tools, 'iris_cut_edit', { operations: [{ op: 'add_clip', sourceId: 'va' }] });
    const clipId = added.results[0].clipId;
    const edit = await call(tools, 'iris_cut_edit', { operations: [
      { op: 'set_clip', clipId, volume: 0.5, speed: 2, transform: { scale: 1.5 } },
      { op: 'set_keyframe', clipId, property: 'opacity', time: 0, value: 0 },
      { op: 'set_keyframe', clipId, property: 'opacity', time: 1, value: 1 },
    ] });
    expect(edit.ok).toBe(true);
    const inspector = await call(tools, 'iris_cut_get_inspector', { clipId });
    expect(inspector.clips[0]).toMatchObject({ volume: 0.5, speed: 2, duration: 4, audio: { volume: 0.5, hasAudio: true } });
    expect(inspector.clips[0].transform.static.scale).toBe(1.5);
    expect(inspector.clips[0].keyframes).toHaveLength(2);
  });

  it('does subtitle CRUD, batch styling and SRT import/export', async () => {
    const imported = await call(tools, 'iris_cut_subtitles', { action: 'import_srt', content: '1\n00:00:00,000 --> 00:00:02,000\n第一句\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond' });
    expect(imported.ok).toBe(true);
    let subs = (await call(tools, 'iris_cut_get_subtitles')).subtitles;
    expect(subs.map((item: { text: string }) => item.text)).toEqual(['第一句', 'Second']);
    expect((await call(tools, 'iris_cut_subtitles', { action: 'update', clipId: subs[1].id, text: '第二句', end: 5 })).ok).toBe(true);
    expect((await call(tools, 'iris_cut_subtitles', { action: 'add', start: 6, end: 7, text: '三' })).ok).toBe(true);
    const styled = await call(tools, 'iris_cut_subtitles', { action: 'style', style: { fontFamily: 'Noto Sans SC', color: '#ffee00', strokeWidth: 0.2, y: 0.8 } });
    expect(styled.style).toMatchObject({ fontFamily: 'Noto Sans SC', color: '#ffee00', y: 0.8 });
    subs = (await call(tools, 'iris_cut_get_subtitles')).subtitles;
    expect((await call(tools, 'iris_cut_subtitles', { action: 'delete', clipIds: [subs[2].id] })).ok).toBe(true);
    const exported = await call(tools, 'iris_cut_subtitles', { action: 'export_srt' });
    expect(exported.content).toBe('1\n00:00:00,000 --> 00:00:02,000\n第一句\n\n2\n00:00:02,000 --> 00:00:05,000\n第二句\n');
    expect((await call(tools, 'iris_cut_subtitles', { action: 'nope' })).ok).toBe(false);
  });

  it('seeks and selects without the page open; play reports that Cut is closed', async () => {
    await call(tools, 'iris_cut_edit', { operations: [{ op: 'add_clip', sourceId: 'va' }] });
    expect((await call(tools, 'iris_cut_playback', { action: 'seek', time: 3.5 })).playhead).toBe(3.5);
    expect((await call(tools, 'iris_cut_playback', { action: 'seek', time: 99 })).playhead).toBe(8);
    const play = await call(tools, 'iris_cut_playback', { action: 'play' });
    expect(play.ok).toBe(false);
    expect(play.note).toBeTruthy();
  });

  it('persists agent edits per canvas project', async () => {
    await call(tools, 'iris_cut_edit', { operations: [{ op: 'add_clip', sourceId: 'va' }] });
    flushCutStore();
    const saved = deserializeCutProject(localStorage.getItem(cutStorageKey(projectId)));
    expect(saved?.clips).toHaveLength(1);
  });

  it('UI actions and agent edits share one undo history', async () => {
    await call(tools, 'iris_cut_edit', { operations: [{ op: 'add_clip', sourceId: 'va' }] });
    cutStore.getState().setPlayhead(4);
    cutStore.getState().select([]);
    runCutAction('split');
    expect(cutStore.getState().doc.present.clips).toHaveLength(2);
    runCutAction('undo');
    expect(cutStore.getState().doc.present.clips).toHaveLength(1);
    runCutAction('undo');
    expect(cutStore.getState().doc.present.clips).toHaveLength(0);
  });

  it('describeTimeline / applyCutOperations are pure', () => {
    const project = addSource(createCutProject(), video('x'));
    const outcome = applyCutOperations(project, [{ op: 'add_clip', sourceId: 'x' }, { op: 'add_subtitle', start: 0, end: 1, text: 'hi' }]);
    expect(project.clips).toHaveLength(0);
    expect(subtitleClips(outcome.project)).toHaveLength(1);
    expect(describeTimeline(outcome.project, { playhead: 0, selection: [], snapping: true, canUndo: false, canRedo: false }).duration).toBe(8);
  });
});
