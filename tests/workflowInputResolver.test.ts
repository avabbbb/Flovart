import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { buildCanonicalGenerationInput, resolveWorkflowInputs, resolveWorkflowResourceReferences } from '../components/workflow/inputResolver';
import { registerWorkflowNodeDefinition } from '../components/workflow/resourceContract';
import type { WorkflowConnection } from '../components/workflow/types';

describe('workflow input resolver', () => {
  it('turns connected nodes into typed resource references without needing @ mentions', () => {
    const image = createWorkflowNode('image-a', 'image', { x: 0, y: 0 }, { artifactRef: { taskId: 'artifact-a', kind: 'image', mimeType: 'image/png' } });
    const text = createWorkflowNode('text-b', 'text', { x: 0, y: 120 }, { content: '让角色回头' });
    const target = createWorkflowNode('video-c', 'video', { x: 420, y: 0 }, { prompt: '电影感', config: { mode: 'video', submode: 'image-to-video', modelId: 'flovart:seedance-2' } });
    const connections: WorkflowConnection[] = [
      { id: 'image-link', fromNodeId: image.id, toNodeId: target.id },
      { id: 'text-link', fromNodeId: text.id, toNodeId: target.id },
    ];

    const resolved = resolveWorkflowInputs(target, [image, text, target], connections);

    expect(resolved.images).toEqual([expect.objectContaining({
      sourceNodeId: 'image-a',
      kind: 'image',
      available: true,
      resourceId: 'image-a:output:0',
      locator: {
        kind: 'runtime-artifact',
        artifactRef: expect.objectContaining({ taskId: 'artifact-a' }),
      },
      artifactRef: expect.objectContaining({ taskId: 'artifact-a' }),
      reference: expect.objectContaining({
        resourceOrigin: 'node',
        sourceId: 'image-a',
        source: 'edge',
      }),
    })]);
    expect(resolved.texts).toEqual([]);
    expect(resolveWorkflowResourceReferences(target, [image, text, target], connections).map(reference => reference.sourceId)).toEqual(['image-a']);
  });

  it('keeps an empty connected media node visible to validation instead of dropping the dependency', () => {
    const image = createWorkflowNode('image-empty', 'image', { x: 0, y: 0 });
    const target = createWorkflowNode('config', 'config', { x: 420, y: 0 });
    const resolved = resolveWorkflowInputs(target, [image, target], [{ id: 'link', fromNodeId: image.id, toNodeId: target.id }]);

    expect(resolved.images).toHaveLength(1);
    expect(resolved.images[0]).toMatchObject({ sourceNodeId: 'image-empty', available: false });
  });

  it('ignores disconnected and self-referential nodes', () => {
    const source = createWorkflowNode('source', 'image', { x: 0, y: 0 }, { href: 'https://cdn.example.com/source.png' });
    const other = createWorkflowNode('other', 'image', { x: 0, y: 120 }, { href: 'https://cdn.example.com/other.png' });
    const target = createWorkflowNode('target', 'config', { x: 420, y: 0 });
    const connections: WorkflowConnection[] = [
      { id: 'self', fromNodeId: target.id, toNodeId: target.id },
      { id: 'source', fromNodeId: source.id, toNodeId: target.id },
      { id: 'other', fromNodeId: other.id, toNodeId: 'different-target' },
    ];

    expect(resolveWorkflowInputs(target, [source, other, target], connections).images.map(resource => resource.sourceNodeId)).toEqual(['source']);
  });

  it('produces role-aware canonical inputs and keeps asset-library as a reference origin', () => {
    const image = createWorkflowNode('asset-node', 'image', { x: 0, y: 0 }, {
      sourceType: 'assetLibrary',
      assetId: 'asset-1',
      href: 'asset-library:asset-1',
      mimeType: 'image/png',
    });
    const target = createWorkflowNode('video-c', 'video', { x: 420, y: 0 }, {
      prompt: '让角色走动',
      config: { mode: 'video', submode: 'image-to-video', modelId: 'flovart:seedance-2' },
    });
    const connections: WorkflowConnection[] = [{ id: 'asset-link', fromNodeId: image.id, toNodeId: target.id }];
    const inputs = resolveWorkflowInputs(target, [image, target], connections);
    const canonical = buildCanonicalGenerationInput({
      targetNode: target,
      inputs,
      prompt: '让角色走动',
      mode: 'video',
      submode: 'image-to-video',
    });

    expect(inputs.images[0]).toMatchObject({
      assetId: 'asset-1',
      href: undefined,
      resourceId: 'asset-node:output:0',
      locator: { kind: 'asset', assetId: 'asset-1' },
      reference: { resourceOrigin: 'asset', sourceId: 'asset-1' },
    });
    expect(canonical.references).toEqual([expect.objectContaining({
      role: 'first_frame',
      resource: expect.objectContaining({ assetId: 'asset-1', sourceNodeId: 'asset-node' }),
    })]);
  });

  it('uses the registered output contract instead of inferring kind from the node type', () => {
    const restore = registerWorkflowNodeDefinition({
      type: 'image',
      output: node => [{
        resourceId: `${node.id}:declared-video`,
        title: node.title,
        kind: 'video',
        locator: { kind: 'remote-url', href: 'https://cdn.example.com/declared-video.mp4' },
      }],
    });
    try {
      const source = createWorkflowNode('source', 'image', { x: 0, y: 0 });
      const target = createWorkflowNode('target', 'config', { x: 420, y: 0 });
      const resolved = resolveWorkflowInputs(target, [source, target], [{ id: 'link', fromNodeId: source.id, toNodeId: target.id }]);

      expect(resolved.images).toHaveLength(0);
      expect(resolved.videos).toMatchObject([{ resourceId: 'source:declared-video', kind: 'video' }]);
    } finally {
      restore();
    }
  });

  it('converges graph and mention references into one golden canonical input', () => {
    const firstFrame = createWorkflowNode('A', 'image', { x: 0, y: 0 }, { href: 'https://cdn.example.com/a.png', mimeType: 'image/png' });
    const character = createWorkflowNode('C', 'image', { x: 0, y: 240 }, { href: 'https://cdn.example.com/c.png', mimeType: 'image/png' });
    const target = createWorkflowNode('B', 'video', { x: 420, y: 0 }, {
      prompt: '让 @ImageC 中的人物转身',
      richTextDocument: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [
          { type: 'mediaMention', attrs: { id: 'C', label: 'ImageC', elementType: 'image' } },
          { type: 'text', text: ' 中的人物转身' },
        ] }],
      },
      config: { mode: 'video', submode: 'image-to-video' },
    });
    const connections: WorkflowConnection[] = [
      { id: 'a', fromNodeId: firstFrame.id, toNodeId: target.id, role: 'source_image' },
      { id: 'c', fromNodeId: character.id, toNodeId: target.id, role: 'reference_image' },
    ];

    const inputs = resolveWorkflowInputs(target, [firstFrame, character, target], connections);
    const canonical = buildCanonicalGenerationInput({ targetNode: target, inputs, prompt: target.metadata.prompt!, mode: 'video', submode: 'image-to-video' });

    expect(canonical).toMatchObject({
      capability: 'image-to-video',
      references: [
        { resource: { resourceId: 'A:output:0' }, role: 'first_frame' },
        { resource: { resourceId: 'C:output:0' }, role: 'reference' },
      ],
    });
    expect(canonical.references).toHaveLength(2);
    expect(canonical.references[1]?.label).toBe('ImageC');
  });

  it('deduplicates a Graph plus rich mention of the same resource', () => {
    const source = createWorkflowNode('source', 'image', { x: 0, y: 0 }, { href: 'https://cdn.example.com/source.png' });
    const target = createWorkflowNode('target', 'image', { x: 420, y: 0 }, {
      prompt: '@角色 生成海报',
      richTextDocument: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mediaMention', attrs: { id: 'source', label: '角色', elementType: 'image' } }] }] },
    });

    const inputs = resolveWorkflowInputs(target, [source, target], [{ id: 'edge', fromNodeId: 'source', toNodeId: 'target' }]);
    const canonical = buildCanonicalGenerationInput({ targetNode: target, inputs, prompt: target.metadata.prompt!, mode: 'image', submode: 'image-to-image' });

    expect(inputs.references).toHaveLength(1);
    expect(canonical.references).toHaveLength(1);
    expect(canonical.references[0]).toMatchObject({ origin: 'graph', label: '角色' });
  });

  it('turns a direct Asset mention into the same canonical resource contract', () => {
    const target = createWorkflowNode('target', 'image', { x: 420, y: 0 }, { prompt: '参考 @场景 修改构图' });
    const inputs = resolveWorkflowInputs(target, [target], [], {
      mentions: [{ assetId: 'asset-scene', label: '场景', elementType: 'image' }],
      assets: [{ id: 'asset-scene', name: '场景', mimeType: 'image/png' }],
    });
    const canonical = buildCanonicalGenerationInput({ targetNode: target, inputs, prompt: target.metadata.prompt!, mode: 'image', submode: 'image-to-image' });

    expect(canonical.references).toEqual([expect.objectContaining({
      origin: 'asset',
      label: '场景',
      resource: expect.objectContaining({ resourceId: 'asset:asset-scene', locator: { kind: 'asset', assetId: 'asset-scene' } }),
    })]);
  });

  it('keeps empty media out of canonical references and reports a diagnostic', () => {
    const source = createWorkflowNode('empty', 'image', { x: 0, y: 0 });
    const target = createWorkflowNode('target', 'video', { x: 420, y: 0 });
    const inputs = resolveWorkflowInputs(target, [source, target], [{ id: 'edge', fromNodeId: 'empty', toNodeId: 'target' }]);
    const canonical = buildCanonicalGenerationInput({ targetNode: target, inputs, prompt: '生成视频', mode: 'video', submode: 'image-to-video' });

    expect(inputs.images).toHaveLength(1);
    expect(canonical.references).toEqual([]);
    expect(canonical.diagnostics).toEqual([expect.objectContaining({ code: 'MISSING_RESOURCE', severity: 'warning' })]);
  });

  it('reports conflicting explicit roles instead of silently selecting one', () => {
    const source = createWorkflowNode('source', 'image', { x: 0, y: 0 }, { href: 'https://cdn.example.com/source.png' });
    const target = createWorkflowNode('target', 'video', { x: 420, y: 0 });
    const inputs = resolveWorkflowInputs(target, [source, target], [
      { id: 'first', fromNodeId: 'source', toNodeId: 'target', role: 'source_image' },
      { id: 'reference', fromNodeId: 'source', toNodeId: 'target', role: 'reference_image' },
    ]);

    expect(inputs.references).toHaveLength(1);
    expect(inputs.diagnostics).toEqual([expect.objectContaining({ code: 'ROLE_CONFLICT', severity: 'error' })]);
  });

  it('maps legacy Seedance selection into canonical references without exposing the legacy field downstream', () => {
    const first = createWorkflowNode('first', 'image', { x: 0, y: 0 }, { href: 'https://cdn.example.com/first.png' });
    const second = createWorkflowNode('second', 'image', { x: 0, y: 120 }, { href: 'https://cdn.example.com/second.png' });
    const target = createWorkflowNode('target', 'video', { x: 420, y: 0 });
    const inputs = resolveWorkflowInputs(target, [first, second, target], [
      { id: 'first-edge', fromNodeId: 'first', toNodeId: 'target' },
      { id: 'second-edge', fromNodeId: 'second', toNodeId: 'target' },
    ], { legacySeedanceRefs: { imageRefs: ['second'], videoRefs: [], audioRefs: [] } });
    const canonical = buildCanonicalGenerationInput({ targetNode: target, inputs, prompt: '让画面动起来', mode: 'video', submode: 'image-to-video' });

    expect(canonical.references.map(reference => reference.resource.sourceNodeId)).toEqual(['second']);
    expect(canonical).not.toHaveProperty('seedanceRefs');
  });

  it('orders canonical references by the connections array order', () => {
    const first = createWorkflowNode('first', 'image', { x: 0, y: 0 }, { href: 'https://cdn.example.com/first.png' });
    const second = createWorkflowNode('second', 'image', { x: 0, y: 120 }, { href: 'https://cdn.example.com/second.png' });
    const target = createWorkflowNode('target', 'video', { x: 420, y: 0 }, {
      config: { mode: 'video', submode: 'image-to-video' },
    });
    const inputs = resolveWorkflowInputs(target, [first, second, target], [
      { id: 'second-edge', fromNodeId: 'second', toNodeId: 'target' },
      { id: 'first-edge', fromNodeId: 'first', toNodeId: 'target' },
    ]);
    const canonical = buildCanonicalGenerationInput({ targetNode: target, inputs, prompt: '让画面动起来', mode: 'video', submode: 'image-to-video' });

    expect(canonical.references.map(reference => reference.resource.sourceNodeId)).toEqual(['second', 'first']);
  });
});
