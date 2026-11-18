import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import type { WorkflowNode } from '../components/workflow/types';
import {
  countStoryboardTags,
  deriveStoryboard,
  filterStoryboardAssets,
  layoutStoryboardNodes,
  storyboardTagOf,
  withStoryboardTag,
} from '../components/reverse/irisStoryboard';

const node = (id: string, type: WorkflowNode['type'], x: number, y: number, extra: Partial<WorkflowNode> = {}): WorkflowNode => ({
  ...createWorkflowNode(id, type, { x, y }),
  title: id,
  ...extra,
});

describe('Iris storyboard derivation', () => {
  it('derives the three asset groups from canvas nodes in reading order, skipping non-asset nodes', () => {
    const nodes = [
      node('img-b', 'image', 400, 0),
      node('note', 'text', 0, 300, { metadata: { content: '旁白：山顶的风' } }),
      node('script', 'script', 0, 0),
      node('img-a', 'image', 0, 10),
      node('clip', 'video', 0, 600),
      node('cfg', 'config', 0, 900),
      node('group', 'subgraph', 0, 1200),
      node('hidden', 'image', 0, 1500, { isVisible: false }),
    ];
    const board = deriveStoryboard(nodes);
    expect(board.text.map(asset => asset.nodeId)).toEqual(['script', 'note']);
    expect(board.image.map(asset => asset.nodeId)).toEqual(['img-a', 'img-b']);
    expect(board.video.map(asset => asset.nodeId)).toEqual(['clip']);
    expect(board.text[1].text).toBe('旁白：山顶的风');
  });

  it('categorizes from the tag stored on the node first, then from node semantics', () => {
    expect(storyboardTagOf(node('s', 'script', 0, 0), 'text')).toEqual({ tag: 'script', explicit: false });
    expect(storyboardTagOf(node('t', 'text', 0, 0), 'text')).toEqual({ tag: 'other', explicit: false });
    expect(storyboardTagOf(node('a', 'image', 0, 0, { anchor: { kind: 'character', approved: true } }), 'image').tag).toBe('character');
    expect(storyboardTagOf(node('p', 'image', 0, 0, { anchor: { kind: 'product', approved: false } }), 'image').tag).toBe('prop');
    expect(storyboardTagOf(node('v', 'video', 0, 0), 'video').tag).toBeNull();
    expect(storyboardTagOf(node('v2', 'video', 0, 0, { shot: { index: 1 } }), 'video').tag).toBe('clip');
    // explicit tag wins over the anchor, and is the same data the canvas node carries
    const tagged = withStoryboardTag(node('x', 'image', 0, 0, { anchor: { kind: 'character', approved: true } }), 'scene');
    expect(tagged.metadata.storyboardTag).toBe('scene');
    expect(storyboardTagOf(tagged, 'image')).toEqual({ tag: 'scene', explicit: true });
    // a tag that does not belong to the kind is ignored
    expect(storyboardTagOf(withStoryboardTag(node('y', 'video', 0, 0), 'character'), 'video').tag).toBeNull();
    // clearing returns to inference
    expect(withStoryboardTag(tagged, null).metadata.storyboardTag).toBeUndefined();
  });

  it('counts and filters by category and search text', () => {
    const board = deriveStoryboard([
      withStoryboardTag(node('雪山', 'image', 0, 0), 'scene'),
      withStoryboardTag(node('队长', 'image', 300, 0), 'character'),
      node('杂项', 'image', 600, 0),
    ]);
    expect(countStoryboardTags(board.image, 'image')).toEqual({ all: 3, character: 1, scene: 1, prop: 0, other: 1 });
    expect(filterStoryboardAssets(board.image, 'scene').map(asset => asset.nodeId)).toEqual(['雪山']);
    expect(filterStoryboardAssets(board.image, 'all', ' 队 ').map(asset => asset.nodeId)).toEqual(['队长']);
  });

  it('reverse-generates canvas positions: same kind continues its row, a new kind starts a row below', () => {
    expect(layoutStoryboardNodes([], [{ kind: 'text', width: 340, height: 220 }])).toEqual([{ x: 0, y: 0 }]);
    const existing = [node('i1', 'image', 100, 50, { width: 300, height: 200 }), node('t1', 'text', 100, 400, { width: 340, height: 220 })];
    const [img, vid, vid2] = layoutStoryboardNodes(existing, [
      { kind: 'image', width: 300, height: 200 },
      { kind: 'video', width: 420, height: 236 },
      { kind: 'video', width: 420, height: 236 },
    ]);
    expect(img).toEqual({ x: 100 + 300 + 48, y: 50 });
    expect(vid).toEqual({ x: 100, y: 620 + 120 });
    expect(vid2).toEqual({ x: 100 + 420 + 48, y: 740 });
  });
});
