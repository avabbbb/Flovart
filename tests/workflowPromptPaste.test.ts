import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { buildWorkflowPromptPasteOps } from '../components/workflow/promptPaste';
import type { WorkflowNode, WorkflowSnapshot } from '../components/workflow/types';

const snapshot = (nodes: WorkflowNode[]): WorkflowSnapshot => ({
  projectId: 'prompt-paste-test',
  title: 'Prompt paste test',
  nodes,
  connections: [],
  selectedNodeIds: [],
  viewport: { x: 0, y: 0, k: 1 },
});

describe('workflow prompt reference paste', () => {
  it('connects the exact copied source node and returns its stable binding', () => {
    const source = createWorkflowNode('character-a', 'image', { x: 0, y: 0 }, {
      href: 'data:image/png;base64,AA==',
    });
    source.title = '角色1';
    const target = createWorkflowNode('target', 'image', { x: 400, y: 300 }, {
      prompt: '',
      config: { mode: 'image' },
    });

    const result = buildWorkflowPromptPasteOps({
      targetNodeId: target.id,
      snapshot: snapshot([source, target]),
      assets: [],
      mentions: [{
        id: source.id,
        label: '角色1',
        thumbnail: source.metadata.href!,
        elementType: 'image',
      }],
      createId: () => 'unused',
    });

    expect(result.resolvedMentions).toEqual([
      expect.objectContaining({ id: source.id, label: '角色1' }),
    ]);
    expect(result.ops).toEqual([
      { type: 'connect_nodes', fromNodeId: source.id, toNodeId: target.id },
      {
        type: 'update_node',
        id: target.id,
        metadata: {
          imageReferenceOrder: [source.id],
          mentionedNodeIds: [source.id],
        },
      },
    ]);
  });

  it('recreates a missing source node from its stable asset id when pasted into another workflow', () => {
    const target = createWorkflowNode('target', 'video', { x: 500, y: 400 }, {
      prompt: '',
      config: { mode: 'video' },
    });
    const result = buildWorkflowPromptPasteOps({
      targetNodeId: target.id,
      snapshot: snapshot([target]),
      assets: [{
        id: 'asset-character-a',
        name: '角色1',
        folderIds: [],
        tags: ['角色'],
        dataUrl: 'data:image/png;base64,AA==',
        mimeType: 'image/png',
        width: 512,
        height: 768,
        createdAt: 1,
      }],
      mentions: [{
        id: 'missing-source-node',
        assetId: 'asset-character-a',
        label: '角色1',
        thumbnail: '',
        elementType: 'image',
        sourceType: 'assetLibrary',
      }],
      createId: () => 'restored-character-node',
    });

    expect(result.resolvedMentions).toEqual([
      expect.objectContaining({
        id: 'restored-character-node',
        assetId: 'asset-character-a',
        label: '角色1',
      }),
    ]);
    expect(result.ops).toEqual([
      expect.objectContaining({
        type: 'add_node',
        node: expect.objectContaining({
          id: 'restored-character-node',
          type: 'image',
          title: '角色1',
          metadata: expect.objectContaining({
            sourceType: 'assetLibrary',
            assetId: 'asset-character-a',
          }),
        }),
      }),
      { type: 'connect_nodes', fromNodeId: 'restored-character-node', toNodeId: target.id },
      {
        type: 'update_node',
        id: target.id,
        metadata: {
          imageReferenceOrder: ['restored-character-node'],
          mentionedNodeIds: ['restored-character-node'],
        },
      },
    ]);
  });
});
