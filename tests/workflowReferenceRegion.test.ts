import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { buildCanonicalGenerationInput, resolveWorkflowInputs, type ResolvedWorkflowResource } from '../components/workflow/inputResolver';
import { createPromptIntent, promptIntentFromNode } from '../components/workflow/promptIntent';
import { requireWorkflowResourceHref } from '../services/workflowResourceResolver';
import { resetBlobUrls } from './setup';

afterEach(() => resetBlobUrls());

const region = { x: 0.25, y: 0, w: 0.5, h: 0.5 };
const doc = (attrs: Record<string, unknown>[]) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: attrs.map(item => ({ type: 'mediaMention', attrs: item })) }],
});

const graph = (mentions: Record<string, unknown>[]) => {
  const image = createWorkflowNode('img-a', 'image', { x: 0, y: 0 }, { storageKey: 'store-a', mimeType: 'image/png', naturalWidth: 2000, naturalHeight: 1000 });
  const target = createWorkflowNode('gen', 'image', { x: 400, y: 0 }, { prompt: '只看她的脸', richTextDocument: doc(mentions), config: { mode: 'image', submode: 'image-to-image' } });
  return { image, target, nodes: [image, target], connections: [{ id: 'c1', fromNodeId: 'img-a', toNodeId: 'gen' }] };
};

describe('region references through the input resolver', () => {
  it('turns a mention with a region into a cropped-identity reference with region pixel size', () => {
    const { target, nodes, connections } = graph([{ id: 'img-a', label: '图片1', elementType: 'image', region }]);
    const inputs = resolveWorkflowInputs(target, nodes, connections);
    expect(inputs.references).toHaveLength(1);
    const resource = inputs.references[0].resource;
    expect(resource.region).toEqual(region);
    expect(resource.resourceId).toMatch(/#r:0\.25,0,0\.5,0\.5$/);
    expect(resource).toMatchObject({ naturalWidth: 1000, naturalHeight: 500, sourceNodeId: 'img-a' });
    // 整图仍在 resources 里，但没有被选进 references
    expect(inputs.images).toHaveLength(1);
    expect(inputs.images[0].region).toBeUndefined();
    const canonical = buildCanonicalGenerationInput({ targetNode: target, inputs, prompt: '只看她的脸', mode: 'image', submode: 'image-to-image' });
    expect(canonical.references[0].resource.region).toEqual(region);
  });

  it('keeps the whole image and its region as two references', () => {
    const { target, nodes, connections } = graph([
      { id: 'img-a', label: '图片1', elementType: 'image' },
      { id: 'img-a', label: '图片1', elementType: 'image', region },
    ]);
    const refs = resolveWorkflowInputs(target, nodes, connections).references;
    expect(refs.map(item => Boolean(item.resource.region))).toEqual([false, true]);
  });

  it('carries the region through PromptIntent and ignores invalid ones', () => {
    const { target } = graph([{ id: 'img-a', label: '图片1', region }, { id: 'img-a', label: '图片1', region: { x: 2, y: 0, w: 1, h: 1 } }]);
    const intent = promptIntentFromNode(target);
    expect(intent.mentions.map(item => item.region)).toEqual([region, undefined]);
    expect(createPromptIntent({ targetNodeId: 'gen', mentions: [{ id: 'img-a' }, { id: 'img-a', region }, { id: 'img-a', region }] }).mentions).toHaveLength(2);
  });
});

describe('region crop at execution time', () => {
  const regioned = (extra: Partial<ResolvedWorkflowResource> = {}) => ({
    resourceId: 'img-a#r:0.25,0,0.5,0.5',
    title: '图片1',
    kind: 'image',
    locator: { kind: 'workflow-storage', storageKey: 'store-a' },
    region,
    ...extra,
  }) as unknown as ResolvedWorkflowResource;

  it('crops through the injected cropper and returns a blob url', async () => {
    const cropRegion = vi.fn(async () => new Blob(['crop'], { type: 'image/png' }));
    const cleanup: string[] = [];
    const href = await requireWorkflowResourceHref(regioned(), { loadMedia: async () => new Blob(['full']), cropRegion }, cleanup);
    expect(href).toMatch(/^blob:/);
    expect(cleanup).toEqual([href]);
    expect(cropRegion).toHaveBeenCalledWith(expect.any(Blob), region, null);
  });

  it('loads the mask for subject picks and fetches remote originals', async () => {
    const cropRegion = vi.fn(async () => new Blob(['crop']));
    const loadRemoteBlob = vi.fn(async () => new Blob(['remote']));
    const mask = new Blob(['mask']);
    await requireWorkflowResourceHref(
      regioned({ locator: { kind: 'remote-url', href: 'https://cdn.example.com/a.png' }, region: { ...region, mask: { storageKey: 'mask-1' } } } as never),
      { loadMedia: async key => key === 'mask-1' ? mask : null, loadRemoteBlob, cropRegion },
      [],
    );
    expect(loadRemoteBlob).toHaveBeenCalledWith('https://cdn.example.com/a.png');
    expect(cropRegion.mock.calls[0][2]).toBe(mask);
  });

  it('fails loudly instead of falling back to the whole image', async () => {
    await expect(requireWorkflowResourceHref(regioned(), { loadMedia: async () => null, cropRegion: vi.fn() }, [])).rejects.toThrow(/区域裁剪/);
    await expect(requireWorkflowResourceHref(regioned({ region: { ...region, mask: { storageKey: 'gone' } } } as never), { loadMedia: async key => key === 'store-a' ? new Blob(['x']) : null, cropRegion: vi.fn() }, [])).rejects.toThrow(/蒙版/);
    await expect(requireWorkflowResourceHref(regioned(), { loadMedia: async () => new Blob(['x']), cropRegion: async () => { throw new Error('boom'); } }, [])).rejects.toThrow(/裁剪失败：boom/);
  });
});
