import { describe, expect, it } from 'vitest';
import { createWorkflowNode } from '../components/workflow/constants';
import { applyWorkflowOps } from '../components/workflow/ops';
import {
  SLASH_SHORTCUTS,
  SlashShortcutError,
  buildShortcutApplyOps,
  describeSlashShortcuts,
  filterSlashShortcuts,
  getSlashShortcut,
  resolveShortcutRequest,
} from '../components/workflow/slashShortcuts';
import type { WorkflowConnection, WorkflowNode } from '../components/workflow/types';

const image = (id: string, x = 0, media = true) => createWorkflowNode(id, 'image', { x, y: 0 }, media ? { href: `https://cdn.example.com/${id}.png`, storageKey: id, mimeType: 'image/png' } : {});
const place = () => ({ x: 999, y: 999 });

const apply = (nodes: WorkflowNode[], connections: WorkflowConnection[], ops: Parameters<typeof applyWorkflowOps>[1]) =>
  applyWorkflowOps({ projectId: 'p', title: 'p', nodes, connections, selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }, ops);

describe('slash shortcut registry', () => {
  it('has stable unique scenes and grid metadata for grid tools', () => {
    const scenes = SLASH_SHORTCUTS.map(item => item.scene);
    expect(new Set(scenes).size).toBe(scenes.length);
    for (const item of SLASH_SHORTCUTS) {
      if (item.kind === 'grid') expect(item.grid).toBeTruthy();
      expect(item.template).toContain('{description}');
    }
    expect(getSlashShortcut('multi-camera-9')?.grid).toEqual({ rows: 3, cols: 3 });
    expect(describeSlashShortcuts().find(item => item.scene === 'storyboard-25')).toMatchObject({ splitTool: 'image.split-grid@1', kind: 'grid' });
  });

  it('filters by label, english label, scene and category', () => {
    expect(filterSlashShortcuts('').length).toBe(SLASH_SHORTCUTS.length);
    expect(filterSlashShortcuts('九宫格').map(item => item.scene)).toEqual(['multi-camera-9']);
    expect(filterSlashShortcuts('turnaround').map(item => item.scene)).toEqual(['character-3-view']);
    expect(filterSlashShortcuts('增强').map(item => item.scene)).toEqual(['lighting-fix', 'portrait-enhance']);
  });
});

describe('resolveShortcutRequest', () => {
  it('grid on a bare generated image → one new node to the right referencing it', () => {
    const src = image('src', 100);
    const request = resolveShortcutRequest({ shortcut: getSlashShortcut('multi-camera-9')!, nodes: [src], connections: [], targetId: 'src' });
    expect(request.placement).toBe('new-node');
    expect(request.generateArgs).toMatchObject({ type: 'image', references: ['src'], count: 1, x: 100 + src.width + 80, y: 0 });
  });

  it('grid on a node that already has an image reference → in place, count 1', () => {
    const ref = image('ref');
    const gen = image('gen', 500, false);
    const connections: WorkflowConnection[] = [{ id: 'c1', fromNodeId: 'ref', toNodeId: 'gen' }];
    const request = resolveShortcutRequest({ shortcut: getSlashShortcut('character-3-view')!, nodes: [ref, gen], connections, targetId: 'gen' });
    expect(request).toMatchObject({ placement: 'in-place', sourceIds: ['ref'], generateArgs: { nodeId: 'gen', references: ['ref'], count: 1 } });
  });

  it('minSources 0 grid on an empty node writes the template in place and keeps the description', () => {
    const gen = createWorkflowNode('gen', 'image', { x: 0, y: 0 }, { prompt: '少年在雨夜追猫' });
    const request = resolveShortcutRequest({ shortcut: getSlashShortcut('story-4-grid')!, nodes: [gen], connections: [], targetId: 'gen' });
    expect(request.placement).toBe('in-place');
    expect(String(request.generateArgs.prompt)).toContain('Content: 少年在雨夜追猫');
    expect(String(request.generateArgs.prompt)).not.toContain('{description}');
  });

  it('non-grid tool always creates one new node to the right', () => {
    const src = image('src');
    const request = resolveShortcutRequest({ shortcut: getSlashShortcut('lighting-fix')!, nodes: [src], connections: [], targetId: 'src' });
    expect(request).toMatchObject({ placement: 'new-node', sourceIds: ['src'] });
  });

  it('rejects text notes and missing sources', () => {
    const note = createWorkflowNode('note', 'text', { x: 0, y: 0 }, { content: 'x' });
    expect(() => resolveShortcutRequest({ shortcut: getSlashShortcut('lighting-fix')!, nodes: [note], connections: [], targetId: 'note' })).toThrow(/备注/);
    expect(() => resolveShortcutRequest({ shortcut: getSlashShortcut('lighting-fix')!, nodes: [], connections: [] })).toThrow(SlashShortcutError);
    const empty = image('empty', 0, false);
    expect(() => resolveShortcutRequest({ shortcut: getSlashShortcut('multi-camera-9')!, nodes: [empty], connections: [], targetId: 'empty' })).toThrow(/源图/);
  });

  it('minSources 0 with no target creates a node at the given position', () => {
    const request = resolveShortcutRequest({ shortcut: getSlashShortcut('storyboard-25')!, nodes: [], connections: [], position: { x: 5, y: 6 }, text: 'a heist' });
    expect(request).toMatchObject({ placement: 'new-node', generateArgs: { type: 'image', x: 5, y: 6, count: 1 } });
  });
});

describe('buildShortcutApplyOps', () => {
  it('creates exactly one generation node (not N) with prompt, @chip and connection', () => {
    const src = image('src');
    const plan = buildShortcutApplyOps({ shortcut: getSlashShortcut('multi-camera-9')!, nodes: [src], connections: [], targetId: 'src', mutationId: 'm1', keys: [], place, createId: () => 'x' });
    expect(plan).toMatchObject({ placement: 'new-node', created: true, grid: { rows: 3, cols: 3 }, sourceIds: ['src'] });
    const adds = plan.plan.operations.filter(op => op.type === 'add_node');
    expect(adds).toHaveLength(1);
    const result = apply([src], [], plan.plan.operations);
    expect(result.rejections).toEqual([]);
    const created = result.snapshot.nodes.find(node => node.id === plan.nodeId)!;
    expect(created.metadata.config?.count ?? 1).toBe(1);
    expect(created.metadata.prompt).toContain('3x3 grid');
    expect(result.snapshot.connections).toEqual([expect.objectContaining({ fromNodeId: 'src', toNodeId: plan.nodeId })]);
    expect(plan.plan.operations.some(op => op.type === 'group_nodes')).toBe(false);
  });

  it('in-place reuses the target node and adds no node', () => {
    const ref = image('ref');
    const gen = image('gen', 500, false);
    const connections: WorkflowConnection[] = [{ id: 'c1', fromNodeId: 'ref', toNodeId: 'gen' }];
    const plan = buildShortcutApplyOps({ shortcut: getSlashShortcut('multi-camera-9')!, nodes: [ref, gen], connections, targetId: 'gen', mutationId: 'm2', keys: [], place });
    expect(plan).toMatchObject({ placement: 'in-place', nodeId: 'gen', created: false });
    expect(plan.plan.operations.filter(op => op.type === 'add_node')).toHaveLength(0);
  });
});

describe('prompt bar slash trigger', () => {
  it('opens only for a freshly typed standalone slash', async () => {
    const { shouldOpenPromptSlashMenu, stripTrailingSlash } = await import('../components/workflow/slashShortcuts');
    expect(shouldOpenPromptSlashMenu('', '/')).toBe(true);
    expect(shouldOpenPromptSlashMenu('雨夜 ', '雨夜 /')).toBe(true);
    expect(shouldOpenPromptSlashMenu('https:', 'https:/')).toBe(false);
    expect(shouldOpenPromptSlashMenu('', 'a/b/')).toBe(false);
    expect(shouldOpenPromptSlashMenu('/', '//')).toBe(false);
    expect(stripTrailingSlash('雨夜 /')).toBe('雨夜');
    expect(stripTrailingSlash('无斜杠')).toBe('无斜杠');
  });
});
