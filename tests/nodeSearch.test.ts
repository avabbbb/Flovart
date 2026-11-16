import { describe, expect, it } from 'vitest';
import {
  assignAnchorCodes,
  nodeSearchStatus,
  normalizeAnchorCode,
  parseAnchorReferences,
  searchWorkflowNodes,
} from '../components/workflow/nodeSearch';
import type { WorkflowNode } from '../components/workflow/types';

const node = (id: string, patch: Partial<WorkflowNode> & { metadata?: Record<string, unknown> } = {}): WorkflowNode => ({
  id,
  type: 'image',
  title: id,
  position: { x: 0, y: 0 },
  width: 100,
  height: 100,
  ...patch,
  metadata: { ...(patch.metadata || {}) },
} as WorkflowNode);

const nodes: WorkflowNode[] = [
  node('hero', { title: '主角 林夏', anchor: { kind: 'character', approved: true, approvedAt: '2026-11-10T00:00:00Z' }, metadata: { href: 'x' } }),
  node('villain', { title: '反派', anchor: { kind: 'character', approved: true, approvedAt: '2026-11-09T00:00:00Z' }, metadata: { href: 'x' } }),
  node('rain', { title: '雨夜街道', anchor: { kind: 'scene', approved: true }, position: { x: 0, y: 50 }, metadata: { href: 'x' } }),
  node('draft', { title: '待定道具', anchor: { kind: 'product', approved: false } }),
  node('shot1', { type: 'video', title: '镜头 1', shot: { index: 1 }, metadata: { prompt: '@ref 林夏 转身走进雨里，镜头缓慢推近', status: 'loading' } }),
  node('shot2', { type: 'video', title: '镜头 2', shot: { index: 2 }, metadata: { status: 'error', error: '余额不足' } }),
  node('note', { type: 'text', title: '备注', metadata: { content: '第二镜要更暗' } }),
  node('inner', { title: '子画布里的图', parentId: 'group1' }),
];

describe('anchor codes', () => {
  it('numbers approved anchors per kind by approval time, then position', () => {
    const codes = assignAnchorCodes(nodes);
    expect(Object.fromEntries(codes)).toEqual({ villain: 'A01', hero: 'A02', rain: 'S01' });
  });

  it('normalizes and parses anchor references', () => {
    expect(normalizeAnchorCode('a2')).toBe('A02');
    expect(normalizeAnchorCode(' S007 ')).toBe('S07');
    expect(normalizeAnchorCode('X1')).toBeUndefined();
    expect(normalizeAnchorCode('A0')).toBeUndefined();
    expect(parseAnchorReferences('A02 + S02 重拍第 3 镜，再参考 f1；shot 4')).toEqual({ codes: ['A02', 'S02', 'F01'], shots: [3, 4] });
    expect(parseAnchorReferences('API2 和 MP4').codes).toEqual([]);
  });
});

describe('searchWorkflowNodes', () => {
  it('derives a compact status per node', () => {
    expect(nodes.map(nodeSearchStatus)).toEqual(['done', 'done', 'done', 'empty', 'running', 'error', 'done', 'empty']);
  });

  it('matches keywords across title, prompt, note content and anchor code', () => {
    expect(searchWorkflowNodes(nodes, { query: '林夏' }).nodes.map(hit => hit.id)).toEqual(['hero', 'shot1']);
    expect(searchWorkflowNodes(nodes, { query: 'a01' }).nodes.map(hit => hit.id)).toEqual(['villain']);
    expect(searchWorkflowNodes(nodes, { query: '雨 推近' }).nodes.map(hit => hit.id)).toEqual(['shot1']);
    expect(searchWorkflowNodes(nodes, { query: '更暗' }).nodes.map(hit => hit.id)).toEqual(['note']);
  });

  it('filters by type, anchor, codes, status, shot and subgraph', () => {
    expect(searchWorkflowNodes(nodes, { types: ['video'] }).total).toBe(2);
    expect(searchWorkflowNodes(nodes, { anchor: 'any' }).total).toBe(4);
    expect(searchWorkflowNodes(nodes, { anchor: 'pending' }).nodes.map(hit => hit.id)).toEqual(['draft']);
    expect(searchWorkflowNodes(nodes, { anchor: 'character' }).nodes.map(hit => hit.id)).toEqual(['hero', 'villain']);
    expect(searchWorkflowNodes(nodes, { anchorCodes: ['a2', 'S1'] }).nodes.map(hit => hit.id)).toEqual(['hero', 'rain']);
    expect(searchWorkflowNodes(nodes, { status: ['error', 'running'] }).nodes.map(hit => hit.id)).toEqual(['shot1', 'shot2']);
    expect(searchWorkflowNodes(nodes, { shotIndex: 2 }).nodes.map(hit => hit.id)).toEqual(['shot2']);
    expect(searchWorkflowNodes(nodes, { parentId: 'group1' }).nodes.map(hit => hit.id)).toEqual(['inner']);
  });

  it('returns compact hits and pages with nextOffset', () => {
    const hit = searchWorkflowNodes(nodes, { shotIndex: 2 }).nodes[0];
    expect(hit).toEqual({ id: 'shot2', type: 'video', title: '镜头 2', status: 'error', hasMedia: false, shotIndex: 2, error: '余额不足' });
    const hero = searchWorkflowNodes(nodes, { anchorCodes: ['A02'] }).nodes[0];
    expect(hero).toMatchObject({ anchorCode: 'A02', anchor: { kind: 'character', approved: true }, hasMedia: true });
    expect(hero).not.toHaveProperty('metadata');

    const first = searchWorkflowNodes(nodes, { limit: 3 });
    expect(first).toMatchObject({ total: 8, offset: 0, limit: 3, nextOffset: 3 });
    const last = searchWorkflowNodes(nodes, { limit: 3, offset: 6 });
    expect(last.nodes).toHaveLength(2);
    expect(last.nextOffset).toBeUndefined();
    expect(searchWorkflowNodes(nodes, { limit: 999 }).limit).toBe(100);
  });
});
