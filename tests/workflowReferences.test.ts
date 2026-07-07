import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import {
  filterSeedanceReferences,
  filterWorkflowInputIds,
  getWorkflowInputNodes,
  toWorkflowMentionItems,
} from '../components/workflow/references';
import type { WorkflowConnection } from '../components/workflow/types';

const nodes = [
  createWorkflowNode('image-a', 'image', { x: 0, y: 0 }, { href: 'https://cdn.example.com/a.png' }),
  createWorkflowNode('video-b', 'video', { x: 0, y: 120 }, { href: 'https://cdn.example.com/b.mp4' }),
  createWorkflowNode('text-c', 'text', { x: 0, y: 240 }, { content: '旁白' }),
  createWorkflowNode('target', 'config', { x: 420, y: 0 }),
  createWorkflowNode('other', 'image', { x: 900, y: 0 }, { href: 'https://cdn.example.com/other.png' }),
];

const connections: WorkflowConnection[] = [
  { id: 'a', fromNodeId: 'image-a', toNodeId: 'target' },
  { id: 'b', fromNodeId: 'video-b', toNodeId: 'target' },
  { id: 'c', fromNodeId: 'target', toNodeId: 'other' },
];

describe('workflow reference inputs', () => {
  it('builds mention candidates only from nodes connected into the target', () => {
    const target = nodes.find(node => node.id === 'target')!;
    const inputNodes = getWorkflowInputNodes(target, nodes, connections);
    expect(inputNodes.map(node => node.id)).toEqual(['image-a', 'video-b']);
    expect(toWorkflowMentionItems(inputNodes).map(item => item.id)).toEqual(['image-a', 'video-b']);
  });

  it('filters stale, duplicate and unconnected mention ids before generation', () => {
    expect(filterWorkflowInputIds(['other', 'image-a', 'image-a', 'missing', 'video-b'], 'target', connections)).toEqual(['image-a', 'video-b']);
  });

  it('keeps Seedance slots inside the same incoming-connection boundary', () => {
    expect(filterSeedanceReferences({
      imageRefs: ['image-a', 'other'],
      videoRefs: ['video-b'],
      audioRefs: ['missing'],
    }, 'target', connections)).toEqual({
      imageRefs: ['image-a'],
      videoRefs: ['video-b'],
      audioRefs: [],
    });
  });
});
