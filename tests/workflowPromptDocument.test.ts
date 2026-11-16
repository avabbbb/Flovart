import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { applyWorkflowOps } from '../components/workflow/ops';
import { buildWorkflowPromptDocument, preservePromptMentions, promptDocumentMentions, promptDocumentToText } from '../components/workflow/promptDocument';
import { extractMentions, editorJSONToText } from '../components/MediaMentionExtension';
import type { WorkflowConnection, WorkflowSnapshot } from '../components/workflow/types';

const imageA = { ...createWorkflowNode('img-a', 'image', { x: 0, y: 0 }), title: '女主' };
const imageB = { ...createWorkflowNode('img-b', 'image', { x: 0, y: 300 }), title: '街景' };
const video = createWorkflowNode('vid-1', 'video', { x: 600, y: 0 });
const connections: WorkflowConnection[] = [
  { id: 'c1', fromNodeId: 'img-a', toNodeId: 'vid-1' },
  { id: 'c2', fromNodeId: 'img-b', toNodeId: 'vid-1' },
];
const nodes = [imageA, imageB, video];

describe('buildWorkflowPromptDocument', () => {
  it('turns @ref:<id>, chip labels and unique titles into mediaMention chips', () => {
    const built = buildWorkflowPromptDocument({
      text: '让 @ref:img-a 走进 @图片2，然后 @女主 转身',
      targetNodeId: 'vid-1',
      nodes,
      connections,
    });
    const mentions = extractMentions(built.richTextDocument);
    expect(mentions.map(item => [item.id, item.label])).toEqual([['img-a', '图片1'], ['img-b', '图片2'], ['img-a', '图片1']]);
    expect(mentions[0]).toMatchObject({ elementType: 'image', sourceType: 'connected' });
    expect(built.mentionIds).toEqual(['img-a', 'img-b']);
    expect(built.prompt).toBe('让 @图片1 走进 @图片2，然后 @图片1 转身');
    expect(built.prompt).toBe(editorJSONToText(built.richTextDocument));
    expect(built.unresolved).toEqual([]);
  });

  it('keeps unknown @ref ids as plain text and reports them', () => {
    const built = buildWorkflowPromptDocument({ text: '参考 @ref:ghost 的构图', targetNodeId: 'vid-1', nodes, connections });
    expect(built.unresolved).toEqual(['ghost']);
    expect(promptDocumentMentions(built.richTextDocument)).toEqual([]);
    expect(built.prompt).toBe('参考 @ref:ghost 的构图');
  });

  it('does not read @图片10 as @图片1', () => {
    const built = buildWorkflowPromptDocument({ text: '对比 @图片10', targetNodeId: 'vid-1', nodes, connections });
    expect(built.mentionIds).toEqual([]);
  });

  it('appends references the text did not mention so they still take part in generation', () => {
    const built = buildWorkflowPromptDocument({ text: '镜头缓推', targetNodeId: 'vid-1', nodes, connections, ensureMentionIds: ['img-a', 'img-b'] });
    expect(built.prompt).toBe('镜头缓推 @图片1 @图片2');
    expect(built.mentionIds).toEqual(['img-a', 'img-b']);
  });

  it('keeps line breaks as paragraphs', () => {
    const built = buildWorkflowPromptDocument({ text: '第一行 @图片1\n第二行', targetNodeId: 'vid-1', nodes, connections });
    expect((built.richTextDocument.content as unknown[]).length).toBe(2);
    expect(promptDocumentToText(built.richTextDocument)).toBe('第一行 @图片1\n第二行');
  });
});

describe('prompt updates keep @references', () => {
  const withDocument = () => {
    const first = buildWorkflowPromptDocument({ text: '@图片1 和 @图片2 同框', targetNodeId: 'vid-1', nodes, connections });
    return {
      ...video,
      metadata: { ...video.metadata, prompt: first.prompt, richTextDocument: first.richTextDocument },
    };
  };

  it('preservePromptMentions re-links labels and appends dropped chips', () => {
    const preserved = preservePromptMentions({ text: '@图片2 在雨里奔跑', previousDocument: withDocument().metadata.richTextDocument, targetNodeId: 'vid-1', nodes, connections });
    expect(preserved?.mentionIds).toEqual(['img-b', 'img-a']);
    expect(preserved?.prompt).toBe('@图片2 在雨里奔跑 @图片1');
  });

  it('returns null when the old document had no chips', () => {
    expect(preservePromptMentions({ text: 'x', previousDocument: { type: 'doc', content: [] }, targetNodeId: 'vid-1', nodes, connections })).toBeNull();
  });

  it('update_node with prompt only no longer wipes the Prompt Bar chips', () => {
    const snapshot: WorkflowSnapshot = {
      projectId: 'p', title: 'p', nodes: [imageA, imageB, withDocument()], connections, selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 },
    };
    const result = applyWorkflowOps(snapshot, [{ type: 'update_node', id: 'vid-1', metadata: { prompt: '新的镜头：@图片1 回头' } }]);
    expect(result.rejections).toEqual([]);
    const updated = result.snapshot.nodes.find(node => node.id === 'vid-1')!;
    expect(extractMentions(updated.metadata.richTextDocument!).map(item => item.id)).toEqual(['img-a', 'img-b']);
    expect(updated.metadata.prompt).toBe('新的镜头：@图片1 回头 @图片2');
  });

  it('a node without chips still gets plain prompt semantics', () => {
    const plain = { ...video, metadata: { ...video.metadata, prompt: 'old', richTextDocument: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'old' }] }] } } };
    const snapshot: WorkflowSnapshot = { projectId: 'p', title: 'p', nodes: [imageA, imageB, plain], connections, selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
    const result = applyWorkflowOps(snapshot, [{ type: 'update_node', id: 'vid-1', metadata: { prompt: 'new' } }]);
    const updated = result.snapshot.nodes.find(node => node.id === 'vid-1')!;
    expect(updated.metadata.prompt).toBe('new');
    expect(updated.metadata.richTextDocument).toBeUndefined();
  });
});
