import { describe, expect, it } from 'vitest';
import { addClip, addSource, createCutProject, deserializeCutProject, findClip, relinkClip, serializeCutProject, type CutSource } from '../services/cut/timeline';
import { canvasNodeVersion, canvasSourceId, listCanvasMedia, staleCanvasClips } from '../services/cut/canvasMedia';

const canvasVideo = (nodeId: string, version: string, duration: number): CutSource => ({
  id: canvasSourceId(nodeId, version), kind: 'video', name: nodeId, duration, origin: { type: 'canvas', nodeId, storageKey: version, version },
});

describe('cut ↔ canvas link', () => {
  it('derives a node result version from existing metadata fields', () => {
    expect(canvasNodeVersion({ metadata: { storageKey: 'k1' } })).toBe('key:k1');
    expect(canvasNodeVersion({ metadata: { storageKey: 'k1', artifactRef: { taskId: 't', kind: 'video', sha256: 'abc' } } })).toBe('sha256:abc');
    expect(canvasNodeVersion({ metadata: { href: 'https://x/a.mp4' } })).toBe('href:https://x/a.mp4');
    expect(canvasNodeVersion({ metadata: {} })).toBe('');
    expect(canvasSourceId('n1', 'key:a')).not.toBe(canvasSourceId('n1', 'key:b'));
    expect(canvasSourceId('n1')).toBe('node:n1');
  });

  it('lists canvas media with its version', () => {
    const media = listCanvasMedia({ nodes: [{ id: 'n1', type: 'video', title: 'Shot', metadata: { storageKey: 'k1' } }] as never });
    expect(media[0]).toMatchObject({ nodeId: 'n1', version: 'key:k1' });
  });

  it('stores the node reference on the clip and survives serialization', () => {
    const v1 = canvasVideo('n1', 'key:a', 8);
    let project = addSource(createCutProject(), v1);
    const added = addClip(project, { kind: 'video', sourceId: v1.id, link: { sourceNodeId: 'n1', sourceVersion: 'key:a' } });
    project = added.project;
    expect(findClip(project, added.clipId!)?.link).toEqual({ sourceNodeId: 'n1', sourceVersion: 'key:a' });
    const restored = deserializeCutProject(serializeCutProject(project))!;
    expect(findClip(restored, added.clipId!)?.link).toEqual({ sourceNodeId: 'n1', sourceVersion: 'key:a' });
  });

  it('flags clips whose node result changed, and relinks only on request', () => {
    const v1 = canvasVideo('n1', 'key:a', 8);
    let project = addSource(createCutProject(), v1);
    const added = addClip(project, { kind: 'video', sourceId: v1.id, link: { sourceNodeId: 'n1', sourceVersion: 'key:a' } });
    project = added.project;
    const clipId = added.clipId!;
    expect(staleCanvasClips(project, [{ id: 'n1', metadata: { storageKey: 'a' } }])).toEqual([]);
    const stale = staleCanvasClips(project, [{ id: 'n1', metadata: { storageKey: 'b' } }]);
    expect(stale).toEqual([{ clipId, nodeId: 'n1', currentVersion: 'key:b' }]);
    // 节点没结果 / 被删除时不标记。
    expect(staleCanvasClips(project, [{ id: 'n1', metadata: {} }])).toEqual([]);
    expect(staleCanvasClips(project, [])).toEqual([]);

    const v2 = canvasVideo('n1', 'key:b', 5);
    project = addSource(project, v2);
    const relinked = relinkClip(project, clipId, v2.id, { sourceNodeId: 'n1', sourceVersion: 'key:b' });
    expect(relinked.ok).toBe(true);
    const clip = findClip(relinked.project, clipId)!;
    expect(clip).toMatchObject({ sourceId: v2.id, duration: 5, start: 0, link: { sourceVersion: 'key:b' } });
    expect(relinked.project.sources.map(source => source.id)).toEqual([v2.id]);
    expect(staleCanvasClips(relinked.project, [{ id: 'n1', metadata: { storageKey: 'b' } }])).toEqual([]);
  });

  it('refuses to relink to a source of another kind', () => {
    const v1 = canvasVideo('n1', 'key:a', 8);
    let project = addSource(createCutProject(), v1);
    const added = addClip(project, { kind: 'video', sourceId: v1.id, link: { sourceNodeId: 'n1', sourceVersion: 'key:a' } });
    project = addSource(added.project, { id: 'aud', kind: 'audio', name: 'a', duration: 3, origin: { type: 'file', fileName: 'a.mp3' } });
    expect(relinkClip(project, added.clipId!, 'aud', { sourceNodeId: 'n1', sourceVersion: 'x' }).ok).toBe(false);
  });
});
