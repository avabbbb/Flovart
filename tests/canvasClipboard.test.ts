import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { copyWorkflowSelection, expandClipSelection, pasteWorkflowClip, remapPromptDocument } from '../components/workflow/canvasClipboard';
import { promptDocumentMentions } from '../components/workflow/promptDocument';
import type { WorkflowConnection, WorkflowNode } from '../components/workflow/types';

const counter = () => { let index = 0; return () => 'n' + (++index); };

const doc = (id: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'mediaMention', attrs: { id, label: '图片1' } }, { type: 'text', text: ' 转身' }] }] });

const fixture = () => {
  const a = createWorkflowNode('a', 'image', { x: 0, y: 0 }, { href: 'https://cdn/a.png', storageKey: 'sk-a' });
  const b = { ...createWorkflowNode('b', 'image', { x: 400, y: 0 }, { prompt: '@图片1 转身', richTextDocument: doc('a') as never, status: 'loading' }) };
  const c = createWorkflowNode('c', 'image', { x: 800, y: 0 });
  const nodes: WorkflowNode[] = [a, b, c];
  const connections: WorkflowConnection[] = [
    { id: 'ab', fromNodeId: 'a', toNodeId: 'b' },
    { id: 'bc', fromNodeId: 'b', toNodeId: 'c' },
  ];
  return { nodes, connections };
};

describe('canvas clipboard', () => {
  it('copies only connections whose both ends are selected', () => {
    const { nodes, connections } = fixture();
    const clip = copyWorkflowSelection({ projectId: 'p1', nodes, connections, ids: ['a', 'b'], now: 1 })!;
    expect(clip.nodes.map(node => node.id)).toEqual(['a', 'b']);
    expect(clip.connections.map(connection => connection.id)).toEqual(['ab']);
    expect(clip.sourceProjectId).toBe('p1');
    // 深拷贝：后续改原节点不影响剪贴板
    nodes[0].title = 'changed';
    expect(clip.nodes[0].title).not.toBe('changed');
  });

  it('returns null for an empty selection', () => {
    const { nodes, connections } = fixture();
    expect(copyWorkflowSelection({ projectId: 'p', nodes, connections, ids: ['missing'] })).toBeNull();
  });

  it('includes descendants of a selected group frame', () => {
    const frame = createWorkflowNode('g', 'subgraph' as never, { x: 0, y: 0 });
    const child = { ...createWorkflowNode('k', 'image', { x: 10, y: 10 }), parentId: 'g' };
    const grandchild = { ...createWorkflowNode('kk', 'image', { x: 20, y: 20 }), parentId: 'k' };
    expect(expandClipSelection([frame, child, grandchild], ['g'])).toEqual(['g', 'k', 'kk']);
  });

  it('remaps ids of nodes, connections, parents, groups and Prompt Bar mentions on paste', () => {
    const { nodes, connections } = fixture();
    nodes[0].batchId = 'grp';
    nodes[1].batchId = 'grp';
    nodes[1].batchGroupSource = 'manual';
    const clip = copyWorkflowSelection({ projectId: 'p1', nodes, connections, ids: ['a', 'b'] })!;
    const pasted = pasteWorkflowClip(clip, { createId: counter() });
    expect(pasted.idMap).toEqual({ a: 'n1', b: 'n2' });
    expect(pasted.nodes.map(node => node.position)).toEqual([{ x: 32, y: 32 }, { x: 432, y: 32 }]);
    expect(pasted.connections).toEqual([{ id: 'conn-n4', fromNodeId: 'n1', toNodeId: 'n2' }]);
    expect(pasted.nodes[0].batchId).toBe('n3');
    expect(pasted.nodes[1].batchId).toBe('n3');
    expect(promptDocumentMentions(pasted.nodes[1].metadata.richTextDocument).map(item => item.id)).toEqual(['n1']);
    expect(pasted.nodes[1].metadata.status).toBe('idle');
    expect(pasted.nodes[0].metadata.storageKey).toBe('sk-a');
    // 原剪贴板不被修改，可重复粘贴
    expect(clip.nodes[0].id).toBe('a');
  });

  it('places a cross-project paste at the anchor and drops dangling parents and single-member groups', () => {
    const lone = { ...createWorkflowNode('x', 'image', { x: 100, y: 200 }), parentId: 'outside', batchId: 'solo', batchGroupSource: 'manual' as const };
    const clip = copyWorkflowSelection({ projectId: 'p1', nodes: [lone], connections: [], ids: ['x'] })!;
    const pasted = pasteWorkflowClip(clip, { createId: counter(), anchor: { x: 1000, y: 1000 } });
    expect(pasted.nodes[0].position).toEqual({ x: 1000, y: 1000 });
    expect(pasted.nodes[0].parentId).toBeUndefined();
    expect(pasted.nodes[0].batchId).toBeUndefined();
  });

  it('leaves mentions of nodes outside the clip untouched', () => {
    expect(promptDocumentMentions(remapPromptDocument(doc('elsewhere'), { a: 'n1' }))[0].id).toBe('elsewhere');
  });
});
