import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function hosts() {
  const source = readFileSync(join(process.cwd(), 'integrations', 'studio', 'shared', 'host-contract.js'), 'utf8');
  const context = { Blob, setInterval, clearInterval, console };
  vm.runInNewContext(source, context);
  return (context as unknown as {
    FlovartStudioHosts: {
      materialized: (selection: unknown, value: unknown) => { selection: unknown; resource: { kind: string }; reference: { kind: string }; blob: Blob };
      createAfterEffectsAdapter: (options: unknown) => any;
      createResolveAdapter: (options: unknown) => any;
    };
  }).FlovartStudioHosts;
}

describe('Studio host bridge contract', () => {
  it('keeps a Premiere selection as context while materializing its current frame as an image reference', () => {
    const selection = { host: 'premiere', selectionId: 'clip-1', label: 'Clip 01', kind: 'video', locator: { projectId: 'project-1', projectItemId: 'clip-1' }, mimeType: 'video/mp4' };
    const blob = new Blob(['frame'], { type: 'image/png' });
    const result = hosts().materialized(selection, { blob, kind: 'image' });
    expect(result.selection).toEqual(selection);
    expect(result.resource).toMatchObject({ kind: 'image', mimeType: 'image/png' });
    expect(result.reference).toMatchObject({ kind: 'image', resourceOrigin: 'creative-host' });
    expect(result.blob).toBe(blob);
  });

  it('keeps After Effects layer identity while using an injected CEP bridge', async () => {
    const bridge = {
      getContext: async () => ({ available: true, documentId: 'comp-1', title: 'Comp 1' }),
      getSelection: async () => ({ selectionId: 'layer-3', label: 'Hero', kind: 'image', locator: { documentId: 'comp-1', layerId: 3 } }),
      materializeLayer: async () => ({ blob: new Blob(['layer'], { type: 'image/png' }) }),
      importArtifact: async () => ({ ok: true, targetId: 'layer-4' }),
    };
    const adapter = hosts().createAfterEffectsAdapter({ bridge });
    await expect(adapter.getContext()).resolves.toMatchObject({ host: 'after-effects', available: true });
    const selection = await adapter.getSelection();
    expect(selection).toMatchObject({ host: 'after-effects', selectionId: 'layer-3' });
    await expect(adapter.materializeSelection(selection!)).resolves.toMatchObject({ selection: { selectionId: 'layer-3' }, resource: { kind: 'image' } });
    await expect(adapter.importArtifact({ mimeType: 'image/png' }, { kind: 'new-layer' })).resolves.toEqual({ ok: true, targetId: 'layer-4' });
  });

  it('keeps Resolve Studio clip identity and uses the Media Pool target', async () => {
    let readCount = 0;
    const bridge = {
      getContext: async () => ({ available: true, projectId: 'project-1', title: 'Project 1' }),
      getSelection: async () => ({ selectionId: 'clip-2', label: 'Shot 02', kind: 'video', locator: readCount++ ? { clipId: 'clip-2', projectId: 'project-1' } : { projectId: 'project-1', clipId: 'clip-2' } }),
      materializeClip: async () => ({ blob: new Blob(['clip'], { type: 'video/mp4' }) }),
      importArtifact: async ({ target }: { target: { kind: string } }) => ({ ok: true, targetId: target.kind }),
    };
    const adapter = hosts().createResolveAdapter({ bridge });
    const selection = await adapter.getSelection();
    expect(selection).toMatchObject({ host: 'resolve', selectionId: 'clip-2', kind: 'video' });
    await expect(adapter.materializeSelection(selection!)).resolves.toMatchObject({ resource: { kind: 'video' } });
    await expect(adapter.importArtifact({ mimeType: 'video/mp4' }, { kind: 'media-pool' })).resolves.toEqual({ ok: true, targetId: 'media-pool' });
  });
});
