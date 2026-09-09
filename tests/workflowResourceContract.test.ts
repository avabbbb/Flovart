import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { getWorkflowNodeDefinition } from '../components/workflow/resourceContract';

describe('workflow node resource contract', () => {
  it('declares a generated media node as an executable runtime-artifact resource', () => {
    const node = createWorkflowNode('image-a', 'image', { x: 0, y: 0 }, {
      artifactRef: { taskId: 'task-a', artifactId: 'artifact-a', kind: 'image', mimeType: 'image/png' },
    });

    expect(getWorkflowNodeDefinition(node.type).output(node)).toEqual([expect.objectContaining({
      resourceId: 'image-a:output:0',
      kind: 'image',
      locator: {
        kind: 'runtime-artifact',
        artifactRef: expect.objectContaining({ taskId: 'task-a', artifactId: 'artifact-a' }),
      },
    })]);
  });

  it('keeps an empty media node as a declared but missing resource', () => {
    const node = createWorkflowNode('image-empty', 'image', { x: 0, y: 0 });

    expect(getWorkflowNodeDefinition(node.type).output(node)).toEqual([expect.objectContaining({
      resourceId: 'image-empty:output:0',
      locator: { kind: 'missing', reason: '节点没有可用媒体' },
    })]);
  });

  it('declares text as an inline resource without inventing a media locator', () => {
    const node = createWorkflowNode('text-a', 'text', { x: 0, y: 0 }, { content: '镜头缓慢推进' });

    expect(getWorkflowNodeDefinition(node.type).output(node)).toEqual([{
      resourceId: 'text-a:output:0',
      title: '文本',
      kind: 'text',
      locator: { kind: 'inline-text', text: '镜头缓慢推进' },
    }]);
  });

  it('carries a creative-host locator into the shared resource contract', () => {
    const node = createWorkflowNode('ps-layer', 'image', { x: 0, y: 0 }, {
      resourceLocator: { kind: 'creative-host', host: 'photoshop', locator: { documentId: 'doc-1', layerId: 42 } },
      mimeType: 'image/png',
    });

    expect(getWorkflowNodeDefinition(node.type).output(node)).toEqual([expect.objectContaining({
      locator: { kind: 'creative-host', host: 'photoshop', locator: { documentId: 'doc-1', layerId: 42 } },
      mimeType: 'image/png',
    })]);
  });
});
