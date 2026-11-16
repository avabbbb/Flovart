import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { alignPromptReferences, planMentionPrunes, removePromptMentions } from '../components/workflow/promptReferenceAlignment';
import { buildWorkflowPromptDocument, promptDocumentMentions } from '../components/workflow/promptDocument';
import type { WorkflowConnection } from '../components/workflow/types';

const media = (id: string, title?: string, type: 'image' | 'video' | 'text' = 'image') => {
  const node = createWorkflowNode(id, type, { x: 0, y: 0 }, type === 'text' ? { content: 'x' } : { href: `https://cdn.example.com/${id}.png`, storageKey: id, mimeType: 'image/png' });
  return title ? { ...node, title } : node;
};

describe('alignPromptReferences', () => {
  const nodes = [media('a', '女主'), media('b', '街景'), media('c', '街景'), media('gen', undefined), media('note', '备注', 'text')];

  it('resolves @"name" to @ref:id and auto-links unconnected mentions in prompt order', () => {
    const result = alignPromptReferences({ text: '让 @"女主" 站在 @ref:b 前', targetNodeId: 'gen', nodes, connections: [], referenceIds: [] });
    expect(result).toMatchObject({ ok: true, text: '让 @ref:a 站在 @ref:b 前', referenceIds: ['a', 'b'], autoLinked: ['a', 'b'] });
  });

  it('keeps explicit references first and does not auto-link what is already connected', () => {
    const connections: WorkflowConnection[] = [{ id: 'c1', fromNodeId: 'b', toNodeId: 'gen' }];
    const result = alignPromptReferences({ text: '@ref:a 和 @ref:b 和 @“女主”', targetNodeId: 'gen', nodes, connections, referenceIds: ['a'] });
    expect(result).toMatchObject({ ok: true, referenceIds: ['a'], autoLinked: [] });
  });

  it('reports ambiguous and unknown names with candidates', () => {
    const ambiguous = alignPromptReferences({ text: '@"街景"', targetNodeId: 'gen', nodes, connections: [], referenceIds: [] });
    expect(ambiguous).toMatchObject({ ok: false, code: 'AMBIGUOUS_NODE_NAME' });
    expect((ambiguous as { details: { candidates: Array<{ nodeId: string }> } }).details.candidates.map(item => item.nodeId)).toEqual(['b', 'c']);
    expect(alignPromptReferences({ text: '@"不存在"', targetNodeId: 'gen', nodes, connections: [], referenceIds: [] })).toMatchObject({ ok: false, code: 'NODE_NAME_NOT_FOUND' });
  });

  it('rejects unlinked mentions under policy=reject and never auto-links notes', () => {
    expect(alignPromptReferences({ text: '@ref:a', targetNodeId: 'gen', nodes, connections: [], referenceIds: [], policy: 'reject' }))
      .toMatchObject({ ok: false, code: 'REFERENCE_NOT_LINKED', details: { nodeIds: ['a'] } });
    expect(alignPromptReferences({ text: '@ref:note', targetNodeId: 'gen', nodes, connections: [], referenceIds: [] })).toMatchObject({ ok: true, autoLinked: [] });
  });
});

describe('mention pruning', () => {
  const nodes = [media('a', '女主'), media('b'), media('gen')];
  const connections: WorkflowConnection[] = [{ id: 'c1', fromNodeId: 'a', toNodeId: 'gen' }, { id: 'c2', fromNodeId: 'b', toNodeId: 'gen' }];
  const doc = buildWorkflowPromptDocument({ text: '把 @ref:a 放进 @ref:b 里', targetNodeId: 'gen', nodes, connections });

  it('removes only the chips of the given ids and re-renders the text', () => {
    const result = removePromptMentions(doc.richTextDocument, new Set(['a']))!;
    expect(result.removedIds).toEqual(['a']);
    expect(promptDocumentMentions(result.document).map(item => item.id)).toEqual(['b']);
    expect(result.prompt).not.toContain('@图片1 ');
    expect(removePromptMentions(doc.richTextDocument, new Set(['zzz']))).toBeNull();
  });

  it('plans prunes for nodes that lost an upstream, ignoring reconnects', () => {
    const withDoc = nodes.map(node => node.id === 'gen' ? { ...node, metadata: { ...node.metadata, richTextDocument: doc.richTextDocument } } : node);
    const prunes = planMentionPrunes({ connections }, { nodes: withDoc, connections: [connections[1]] });
    expect(prunes).toHaveLength(1);
    expect(prunes[0]).toMatchObject({ nodeId: 'gen', removedIds: ['a'] });
    expect(planMentionPrunes({ connections }, { nodes: withDoc, connections: [{ ...connections[1] }, { ...connections[0], id: 'c3' }] })).toEqual([]);
  });
});
